import { createInitialProgress, getEnemyIntent, performAction, startBattle } from "../game/engine";
import type { ActionId, BattleState, EnemyIntent } from "../game/types";
import { STRATEGIES } from "./strategies";
import type { ActionTrace, Scenario, SimulationOutcome, SimulationResult, Strategy } from "./types";

export const MAX_ACTIONS = 200;
export const BASELINE_SCENARIOS: readonly Scenario[] = Object.freeze(
  (["light", "heavy", "boss"] as const).flatMap(enemyId =>
    (["A", "B", "C", "D"] as const).map(strategyId => Object.freeze({ enemyId, strategyId }))),
);

function freeze<T>(value: T): T {
  if (value !== null && typeof value === "object") {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
}
function validState(state: BattleState): boolean {
  const p = state.player;
  return [p.hp, p.energy, p.energyCap, state.enemy.hp, state.turn, state.enemyAttacksExecuted,
    ...Object.values(p.upgrades)].every(Number.isFinite)
    && p.energy >= 0 && p.energy <= p.energyCap && p.energyCap >= 0
    && Object.values(p.upgrades).every(n => Number.isInteger(n) && n >= 0)
    && Number.isInteger(state.turn) && state.turn >= 1
    && Number.isInteger(state.enemyAttacksExecuted) && state.enemyAttacksExecuted >= 0
    && (state.phase === "ongoing" ? p.hp > 0 && state.enemy.hp > 0
      : state.phase === "victory" ? state.enemy.hp <= 0 && p.hp > 0
        : state.phase === "defeat" && p.hp <= 0 && state.enemy.hp > 0);
}
const effectiveLoss = (before: number, after: number) => Math.max(0, before) - Math.max(0, after);

/** Fresh independent battle; optional policy/lower limit support diagnostic tests, never the baseline. */
export function runSimulation(scenario: Scenario, options: {
  readonly chooseAction?: Strategy;
  readonly maxActions?: number;
} = {}): SimulationResult {
  const initialState = freeze(startBattle(scenario.enemyId, createInitialProgress()));
  let state = initialState;
  let outcome: SimulationOutcome = "timeout";
  let reason: string | null = null;
  const actions: ActionTrace[] = [];
  const counts: Record<ActionId, number> = { attack: 0, heavy: 0, defend: 0, charge: 0 };
  let totalDamageTaken = 0, totalDamageDealt = 0, rawHpLossTaken = 0, rawHpLossDealt = 0;
  let enemyAttacks = 0, bossNormalAttacks = 0, bossSpecialAttacks = 0;
  const limit = options.maxActions ?? MAX_ACTIONS;
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_ACTIONS) {
    outcome = "error";
    reason = `maxActions must be an integer from 1 to ${MAX_ACTIONS}`;
  } else {
    const chooseAction = options.chooseAction ?? STRATEGIES[scenario.strategyId];
    for (let i = 0; i < limit; i++) {
      const before = state;
      let action: ActionId | null = null;
      let intentBefore: EnemyIntent | null = null;
      try {
        if (!validState(before) || before.phase !== "ongoing") throw new Error("Invalid or non-ongoing input state");
        intentBefore = freeze(getEnemyIntent(before));
        if (intentBefore === null) throw new Error("Ongoing battle has no enemy intent");
        action = chooseAction(before, intentBefore);
        const result = performAction(before, action);
        if (!result.accepted) {
          outcome = "error";
          reason = `Engine rejected action: ${result.reason}`;
          actions.push({ attempt: i + 1, action, intentBefore, before, after: result.state, accepted: false, effects: null, error: reason });
          break;
        }
        const next = result.state;
        const attackDelta = next.enemyAttacksExecuted - before.enemyAttacksExecuted;
        if (!validState(next) || next.enemy.id !== before.enemy.id || next.turn !== before.turn + 1
          || next.player.hp > before.player.hp || next.enemy.hp > before.enemy.hp
          || ![0, 1].includes(attackDelta)
          || attackDelta !== (result.effects.enemyIntent === null ? 0 : 1)) {
          throw new Error("Invalid engine output state or attack count");
        }
        state = freeze(next);
        counts[action]++;
        totalDamageTaken += effectiveLoss(before.player.hp, state.player.hp);
        totalDamageDealt += effectiveLoss(before.enemy.hp, state.enemy.hp);
        rawHpLossTaken += before.player.hp - state.player.hp;
        rawHpLossDealt += before.enemy.hp - state.enemy.hp;
        enemyAttacks += attackDelta;
        const executed = result.effects.enemyIntent;
        if (scenario.enemyId === "boss" && executed !== null) {
          if (executed.kind === "special") bossSpecialAttacks++;
          else bossNormalAttacks++;
        }
        actions.push({ attempt: i + 1, action, intentBefore, before, after: state, accepted: true, effects: result.effects, error: null });
        if (state.phase !== "ongoing") {
          outcome = state.phase;
          break;
        }
      } catch (error) {
        outcome = "error";
        reason = error instanceof Error ? error.message : String(error);
        actions.push({ attempt: i + 1, action, intentBefore, before, after: state, accepted: false, effects: null, error: reason });
        break;
      }
    }
    if (outcome === "timeout") reason = `Still ongoing after ${limit} accepted player actions`;
  }
  return {
    summary: {
      ...scenario,
      initialPlayerHp: initialState.player.hp, initialEnergy: initialState.player.energy,
      initialEnergyCap: initialState.player.energyCap, initialEnemyHp: initialState.enemy.hp,
      outcome, actionAttempts: actions.length, playerActions: Object.values(counts).reduce((a, b) => a + b, 0),
      enemyAttacks, playerHp: state.player.hp, enemyHp: state.enemy.hp, finalEnergy: state.player.energy,
      totalDamageTaken, totalDamageDealt, rawHpLossTaken, rawHpLossDealt,
      attackCount: counts.attack, heavyCount: counts.heavy, defendCount: counts.defend, chargeCount: counts.charge,
      bossNormalAttacks, bossSpecialAttacks, reason,
    },
    initialState, finalState: state, actions,
  };
}

export function runBaseline(): SimulationResult[] {
  return BASELINE_SCENARIOS.map(scenario => runSimulation(scenario));
}
