import { act, challengeIntent, createChallenge, selectUpgrade, type ChallengeState } from "../challenge/controller";
import type { ActionId, BattleState, UpgradeId } from "../game/types";
import { MAX_ACTIONS } from "./run-simulation";
import { STRATEGIES } from "./strategies";
import type { ActionTrace, SimulationOutcome, SimulationResult, SimulationSummary, Strategy, StrategyId } from "./types";

export type UpgradePath = readonly [UpgradeId, UpgradeId];
export interface ChallengeScenario { readonly strategyId: StrategyId; readonly upgradePath: UpgradePath }
const upgrades = ["blade", "core", "armor"] as const;
export const UPGRADE_PATHS: readonly UpgradePath[] = Object.freeze(upgrades.flatMap(a => upgrades.map(b => Object.freeze([a, b] as const))));
export const CHALLENGE_SCENARIOS: readonly ChallengeScenario[] = Object.freeze(UPGRADE_PATHS.flatMap(upgradePath =>
  (["A", "B", "C", "D", "E", "F"] as const).map(strategyId => Object.freeze({ strategyId, upgradePath }))));
export interface UpgradeTrace {
  readonly encounter: number;
  readonly upgrade: UpgradeId;
  readonly before: BattleState;
  readonly after: BattleState;
}
export interface ChallengeBattle extends SimulationResult {
  readonly execution: { readonly maxActionsPerBattle: number };
  readonly summary: SimulationSummary & { readonly overkillDamageTaken: number; readonly overkillDamageDealt: number };
}
export interface ChallengeDiagnostics {
  readonly execution: { readonly maxActionsPerBattle: number };
  readonly scenario: ChallengeScenario;
  readonly summary: {
    readonly outcome: SimulationOutcome;
    readonly reason: string | null;
    readonly startedBattles: number;
    readonly completedBattles: number;
    readonly actionAttempts: number;
    readonly playerActions: number;
    readonly enemyAttacks: number;
    readonly totalDamageTaken: number;
    readonly totalDamageDealt: number;
    readonly rawHpLossTaken: number;
    readonly rawHpLossDealt: number;
    readonly overkillDamageTaken: number;
    readonly overkillDamageDealt: number;
    readonly playerHp: number;
    readonly enemyHp: number;
    readonly finalEnergy: number;
    readonly attackCount: number;
    readonly heavyCount: number;
    readonly defendCount: number;
    readonly chargeCount: number;
    readonly bossNormalAttacks: number;
    readonly bossSpecialAttacks: number;
  };
  readonly battles: readonly ChallengeBattle[];
  readonly upgrades: readonly UpgradeTrace[];
}
function freeze<T>(value: T): T {
  if (value !== null && typeof value === "object") {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
}
function valid(s: BattleState): boolean {
  return [s.player.hp, s.player.energy, s.player.energyCap, s.enemy.hp, s.turn, s.enemyAttacksExecuted,
    ...Object.values(s.player.upgrades)].every(Number.isFinite)
    && s.player.energy >= 0 && s.player.energy <= s.player.energyCap
    && Object.values(s.player.upgrades).every(n => Number.isInteger(n) && n >= 0)
    && Number.isInteger(s.turn) && s.turn >= 1 && Number.isInteger(s.enemyAttacksExecuted) && s.enemyAttacksExecuted >= 0
    && (s.phase === "ongoing" ? s.player.hp > 0 && s.enemy.hp > 0
      : s.phase === "victory" ? s.player.hp > 0 && s.enemy.hp <= 0 : s.phase === "defeat" && s.player.hp <= 0 && s.enemy.hp > 0);
}
const loss = (a: number, b: number) => Math.max(0, a) - Math.max(0, b);

/** R1 reconstruction. Runs one scenario only; constructing the matrix does not execute it.
 * chooseAction/maxActions are diagnostic test hooks; production uses the registered strategy and 200.
 * Invalid accepted outputs count as accepted attempts and retain their raw trace; damage totals and final state retain only validated outputs.
 */
export function runChallengeDiagnostics(scenario: ChallengeScenario, options: {
  readonly chooseAction?: Strategy; readonly maxActions?: number;
} = {}): ChallengeDiagnostics {
  if (scenario === null || typeof scenario !== "object" || Array.isArray(scenario)) {
    throw new TypeError("Invalid challenge scenario: expected an object");
  }
  const { upgradePath, strategyId } = scenario;
  if (!Array.isArray(upgradePath) || upgradePath.length !== 2
    || !Object.hasOwn(upgradePath, 0) || !Object.hasOwn(upgradePath, 1)
    || !upgrades.includes(upgradePath[0]) || !upgrades.includes(upgradePath[1])) {
    throw new TypeError("Invalid upgradePath: expected exactly two entries from blade, core, armor");
  }
  if (typeof strategyId !== "string" || !Object.hasOwn(STRATEGIES, strategyId)) {
    throw new TypeError("Invalid strategyId: expected an own strategy ID from A through F");
  }
  const plan: ChallengeScenario = freeze({ strategyId, upgradePath: [upgradePath[0], upgradePath[1]] as const });
  const limit = options.maxActions ?? MAX_ACTIONS;
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_ACTIONS) throw new RangeError("maxActions must be 1..200");
  let state: ChallengeState = freeze(createChallenge(Symbol("diagnostic challenge")));
  const battles: ChallengeBattle[] = [], transitions: UpgradeTrace[] = [];
  let outcome: SimulationOutcome = "error", reason: string | null = null;
  while (true) {
    const initialState = state.battle;
    const actions: ActionTrace[] = [];
    const counts = { attack: 0, heavy: 0, defend: 0, charge: 0 };
    let taken = 0, dealt = 0, rawTaken = 0, rawDealt = 0, attacks = 0, normal = 0, special = 0;
    outcome = "timeout"; reason = null;
    for (let n = 0; n < limit; n++) {
      const before = state.battle;
      let action: ActionId | null = null;
      let intent: ActionTrace["intentBefore"] = null;
      let trace: ActionTrace | null = null;
      try {
        if (!valid(before) || state.phase !== "battle") throw new Error("Invalid battle input");
        intent = freeze(challengeIntent(state));
        if (!intent) throw new Error("Missing enemy intent");
        action = (options.chooseAction ?? STRATEGIES[plan.strategyId])(before, intent);
        const next = act(state, action);
        const result = next.result;
        if (!result) throw new Error("Controller did not execute action");
        trace = { attempt: n + 1, action, intentBefore: intent, before, after: result.state,
          accepted: result.accepted, effects: result.accepted ? result.effects : null,
          error: result.accepted ? null : `Engine rejected action: ${result.reason}` };
        if (!result.accepted) throw new Error(trace.error!);
        counts[action]++;
        const after = result.state, delta = after.enemyAttacksExecuted - before.enemyAttacksExecuted;
        if (!valid(after) || after.enemy.id !== before.enemy.id || after.turn !== before.turn + 1
          || after.player.hp > before.player.hp || after.enemy.hp > before.enemy.hp
          || ![0, 1].includes(delta) || delta !== (result.effects.enemyIntent === null ? 0 : 1)) throw new Error("Invalid engine output");
        state = freeze(next.state);
        attacks += delta;
        taken += loss(before.player.hp, after.player.hp); dealt += loss(before.enemy.hp, after.enemy.hp);
        rawTaken += before.player.hp - after.player.hp; rawDealt += before.enemy.hp - after.enemy.hp;
        if (before.enemy.id === "boss" && result.effects.enemyIntent) {
          if (result.effects.enemyIntent.kind === "special") special++; else normal++;
        }
        actions.push(freeze(trace));
        if (after.phase !== "ongoing") { outcome = after.phase; break; }
      } catch (error) {
        outcome = "error"; reason = error instanceof Error ? error.message : String(error);
        actions.push(freeze(trace ? { ...trace, error: reason } : { attempt: n + 1, action, intentBefore: intent,
          before, after: state.battle, accepted: false, effects: null, error: reason }));
        break;
      }
    }
    if (outcome === "timeout") reason = `Still ongoing after ${limit} accepted player actions`;
    const finalState = state.battle;
    battles.push(freeze({ execution: { maxActionsPerBattle: limit }, initialState, finalState, actions, summary: {
      enemyId: initialState.enemy.id, strategyId: plan.strategyId, initialPlayerHp: initialState.player.hp,
      initialEnergy: initialState.player.energy, initialEnergyCap: initialState.player.energyCap, initialEnemyHp: initialState.enemy.hp,
      outcome, reason, actionAttempts: actions.length, playerActions: Object.values(counts).reduce((a, b) => a + b, 0),
      enemyAttacks: attacks, playerHp: finalState.player.hp, enemyHp: finalState.enemy.hp, finalEnergy: finalState.player.energy,
      totalDamageTaken: taken, totalDamageDealt: dealt, rawHpLossTaken: rawTaken, rawHpLossDealt: rawDealt,
      overkillDamageTaken: rawTaken - taken, overkillDamageDealt: rawDealt - dealt,
      attackCount: counts.attack, heavyCount: counts.heavy, defendCount: counts.defend, chargeCount: counts.charge,
      bossNormalAttacks: normal, bossSpecialAttacks: special,
    } }));
    if (outcome !== "victory" || state.phase === "victory") break;
    const before = state.battle, encounter = state.encounter, upgrade = plan.upgradePath[encounter];
    try {
      const next = selectUpgrade(state, upgrade, encounter, state.challengeId);
      if (next === state || next.encounter !== encounter + 1 || next.phase !== "battle") throw new Error("Upgrade transition rejected");
      transitions.push(freeze({ encounter, upgrade, before, after: next.battle }));
      state = freeze(next);
    } catch (error) {
      outcome = "error"; reason = error instanceof Error ? error.message : String(error); break;
    }
  }
  const sum = (key: keyof SimulationResult["summary"]) => battles.reduce((n, b) => n + Number(b.summary[key]), 0);
  return freeze({ execution: { maxActionsPerBattle: limit }, scenario: plan, battles, upgrades: transitions, summary: {
    outcome, reason, startedBattles: battles.length, completedBattles: battles.filter(b => b.summary.outcome === "victory").length,
    actionAttempts: sum("actionAttempts"), playerActions: sum("playerActions"), enemyAttacks: sum("enemyAttacks"),
    totalDamageTaken: sum("totalDamageTaken"), totalDamageDealt: sum("totalDamageDealt"),
    rawHpLossTaken: sum("rawHpLossTaken"), rawHpLossDealt: sum("rawHpLossDealt"),
    overkillDamageTaken: sum("rawHpLossTaken") - sum("totalDamageTaken"),
    overkillDamageDealt: sum("rawHpLossDealt") - sum("totalDamageDealt"),
    playerHp: state.battle.player.hp, enemyHp: state.battle.enemy.hp, finalEnergy: state.battle.player.energy,
    attackCount: sum("attackCount"), heavyCount: sum("heavyCount"), defendCount: sum("defendCount"), chargeCount: sum("chargeCount"),
    bossNormalAttacks: sum("bossNormalAttacks"), bossSpecialAttacks: sum("bossSpecialAttacks"),
  } });
}
