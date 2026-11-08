import { applyUpgrade, createInitialProgress, getEnemyIntent, getPlayerProgress, performAction, startBattle } from "../../game/engine";
import { GAME_CONFIG } from "../../../data/game-config";
import type { ActionId, EnemyIntent, UpgradeId } from "../../game/types";
import { isDeepStrictEqual } from "node:util";
import type { StrategyId, SimulationOutcome } from "../types";
import { STRATEGIES } from "../strategies";
import { validateMechanism, type DefenseMechanism } from "./config";
import { performR2Action, type R2ActionResult, type R2State } from "./mechanics";
import type { R2Decision } from "./strategies";
import { chooseR2Policy, validatePolicy, type R2PolicyVersion } from "./policy";
import type { PolicyEvidence } from "./adaptive-strategies";
import { summarizeR2 } from "./statistics";

export interface R2Scenario { readonly strategyId: StrategyId; readonly upgradePath: readonly [UpgradeId, UpgradeId]; readonly policyVersion?: R2PolicyVersion }
export type R2ErrorStage = "snapshot" | "intent" | "policy" | "decision-validation" | "execution" | "result-validation" | "recording";
export type R2ErrorKind = "exception" | "invalid-output" | "rejected";
export class R2ValidationError extends TypeError {}
class R2Rejection extends Error {}
interface R2TraceBase {
  readonly before: R2State; readonly after: R2State;
  readonly intentBefore: ReturnType<typeof getEnemyIntent>;
  readonly accepted: boolean; readonly effects: R2ActionResult["result"] | null;
  readonly defense: R2ActionResult["defense"];
  readonly actualDefenseReduction: number;
  readonly rawPolicy: unknown;
  readonly executionResult: unknown;
}
export type R2Trace = R2TraceBase & (
  | { readonly accepted: true; readonly decision: R2Decision; readonly policyEvidence: PolicyEvidence;
      readonly error: null; readonly errorStage: null; readonly errorKind: null }
  | { readonly accepted: false; readonly decision: R2Decision | null; readonly policyEvidence: PolicyEvidence | null;
      readonly error: string; readonly errorStage: R2ErrorStage; readonly errorKind: R2ErrorKind });
export interface R2Battle {
  readonly initial: R2State; readonly final: R2State; readonly outcome: SimulationOutcome;
  readonly actions: readonly R2Trace[];
}
export interface R2Upgrade { readonly upgrade: UpgradeId; readonly before: R2State; readonly after: R2State }
export interface R2Run {
  readonly scenario: R2Scenario; readonly mechanism: DefenseMechanism; readonly maxActionsPerBattle: number;
  readonly battles: readonly R2Battle[]; readonly upgrades: readonly R2Upgrade[];
  readonly outcome: SimulationOutcome; readonly error: string | null;
  readonly summary: ReturnType<typeof summarizeR2>;
}
const ENEMIES = ["light", "heavy", "boss"] as const;
/** Injection is confined to failure tests; the verifier always uses real implementations. */
export interface R2RunnerDependencies {
  readonly snapshot: (state: R2State) => R2State;
  readonly intent: typeof getEnemyIntent;
  readonly policy: (...args: Parameters<typeof chooseR2Policy>) => unknown;
  readonly execute: (...args: Parameters<typeof performR2Action>) => unknown;
  readonly retainResult: (value: R2ActionResult) => R2ActionResult;
  readonly validateResult: typeof validateExecutionResult;
}
const copyState = (s: R2State): R2State => ({ consecutiveDefenses: s.consecutiveDefenses,
  battle: { ...s.battle, player: { ...s.battle.player, upgrades: { ...s.battle.player.upgrades } }, enemy: { ...s.battle.enemy } } });
export function isR2State(value: unknown): value is R2State {
  if (!value || typeof value !== "object") return false;
  const s = value as R2State, b = s.battle;
  return !!b && !!b.player && !!b.player.upgrades && !!b.enemy
    && [s.consecutiveDefenses, b.turn, b.enemyAttacksExecuted].every(n => Number.isSafeInteger(n) && n >= 0)
    && [b.player.hp, b.player.energy, b.player.energyCap, b.enemy.hp].every(Number.isFinite)
    && [b.player.upgrades.blade, b.player.upgrades.core, b.player.upgrades.armor].every(n => Number.isSafeInteger(n) && n >= 0)
    && ["light", "heavy", "boss"].includes(b.enemy.id) && ["ongoing", "victory", "defeat"].includes(b.phase);
}
export function validateDecisionResult(value: unknown, scenario: R2Scenario): asserts value is ReturnType<typeof chooseR2Policy> {
  if (!value || typeof value !== "object") throw new R2ValidationError("Invalid R2 policy result");
  const p = value as ReturnType<typeof chooseR2Policy>, d = p.decision, e = p.evidence;
  const actions: readonly unknown[] = ["attack", "heavy", "defend", "charge"];
  if (!d || !actions.includes(d.action) || !actions.includes(d.originalIntent)
    || d.strategyVersion !== (scenario.policyVersion ?? `R2-compat-${scenario.strategyId}-v1`)
    || ![null, "defense-insufficient-energy"].includes(d.fallbackReason)
    || !e || typeof e.reason !== "string" || !e.reason.length || typeof e.defenseAffordable !== "boolean"
    || ![e.consecutiveDefensesBefore, e.defenseCost, e.defenseMultiplier, e.defenseReductionAvailable,
      e.defenseDamagePreventable, e.defenseHpAfter].every(Number.isFinite)
    || !Array.isArray(e.candidates) || e.candidates.length === 0
    || e.candidates.some(c => !c || !actions.includes(c.action) || ![c.hpAfter, c.energyAfter, c.playerDamage].every(Number.isFinite)
      || typeof c.survives !== "boolean" || typeof c.victory !== "boolean")) throw new R2ValidationError("Invalid R2 decision/evidence structure");
}
/** Structural and transition checks do not reselect or retry the policy. */
export function validateExecutionResult(value: unknown, before: R2State, action: ActionId, config: DefenseMechanism): asserts value is R2ActionResult {
  if (!value || typeof value !== "object") throw new R2ValidationError("Invalid R2 execution result");
  const step = value as R2ActionResult;
  if (!isR2State(step.state) || !step.result || typeof step.result.accepted !== "boolean"
    || !isDeepStrictEqual(step.result.state, step.state.battle)) throw new R2ValidationError("Invalid R2 execution state/result");
  // Pure projection, NOT another call to the injected executor or an execution retry.
  const base = performAction(before.battle, action);
  let expected: R2ActionResult = { state: before, result: base, defense: null };
  if (base.accepted && action !== "defend") expected = { state: { battle: base.state, consecutiveDefenses: 0 }, result: base, defense: null };
  if (base.accepted && action === "defend" && before.battle.player.energy >= config.defenseCost) {
    const streak = before.consecutiveDefenses + 1, factors = config.defenseReductionMultipliers;
    const multiplier = factors[Math.min(streak - 1, factors.length - 1)];
    const reductionAvailable = (config.defenseReduction + before.battle.player.upgrades.armor * GAME_CONFIG.upgrades.armor.reduction) * multiplier;
    const intent = base.effects.enemyIntent, damageTaken = Math.max(0, (intent?.damage ?? 0) - reductionAvailable);
    const hp = before.battle.player.hp - damageTaken;
    const energy = Math.min(before.battle.player.energyCap, before.battle.player.energy - config.defenseCost + config.defenseGain);
    const battle = { ...base.state, player: { ...base.state.player, hp, energy },
      phase: base.state.enemy.hp <= 0 ? "victory" as const : hp <= 0 ? "defeat" as const : "ongoing" as const };
    expected = { state: { battle, consecutiveDefenses: streak }, result: { accepted: true, state: battle, effects: { ...base.effects, damageTaken } },
      defense: { multiplier, reductionAvailable, damagePrevented: intent === null ? 0 : intent.damage - damageTaken,
        energySpent: config.defenseCost, energyGained: energy - (before.battle.player.energy - config.defenseCost) } };
  }
  if (before.battle.phase === "ongoing" && action === "defend" && before.battle.player.energy < config.defenseCost) {
    expected = { state: before, result: { accepted: false, state: before.battle, reason: "insufficient-energy" }, defense: null };
  }
  if (!isDeepStrictEqual(step, expected)) throw new R2ValidationError("R2 execution result differs from real transition");
}
export const R2_SCENARIOS: readonly R2Scenario[] = Object.freeze(
  (["blade", "core", "armor"] as const).flatMap(first => (["blade", "core", "armor"] as const).flatMap(second =>
    (["A", "B", "C", "D", "E", "F"] as const).map(strategyId => Object.freeze({ strategyId,
      upgradePath: Object.freeze([first, second]) as readonly [UpgradeId, UpgradeId] })))));
export function validateScenario(scenario: R2Scenario): void {
  if (!scenario || !Object.hasOwn(STRATEGIES, scenario.strategyId) || !Array.isArray(scenario.upgradePath)
    || scenario.upgradePath.length !== 2 || Array.from(scenario.upgradePath).some(x => !["blade", "core", "armor"].includes(x))) {
    throw new TypeError("Invalid R2 scenario");
  }
  validatePolicy(scenario.strategyId, scenario.policyVersion);
}
/** One explicitly requested challenge; there is deliberately no matrix execution entry point. */
export function runR2Challenge(scenario: R2Scenario, mechanism: DefenseMechanism, maxActionsPerBattle = 200,
  dependencies: Partial<R2RunnerDependencies> = {}): R2Run {
  validateScenario(scenario); validateMechanism(mechanism);
  if (!Number.isSafeInteger(maxActionsPerBattle) || maxActionsPerBattle < 1) throw new TypeError("Invalid R2 action limit");
  const { policyVersion, ...sourcePlan } = structuredClone(scenario);
  const plan: R2Scenario = policyVersion === undefined ? sourcePlan : { ...sourcePlan, policyVersion };
  const config = structuredClone(mechanism);
  const deps: R2RunnerDependencies = { snapshot: structuredClone, intent: getEnemyIntent, policy: chooseR2Policy, execute: performR2Action, retainResult: structuredClone, validateResult: validateExecutionResult, ...dependencies };
  const battles: R2Battle[] = [], upgrades: R2Upgrade[] = [];
  let progress = createInitialProgress(), outcome: SimulationOutcome = "error", error: string | null = null;
  for (let encounter = 0; encounter < 3; encounter++) {
    let state: R2State = { battle: startBattle(ENEMIES[encounter], progress), consecutiveDefenses: 0 };
    const initial = structuredClone(state), actions: R2Trace[] = [];
    let accepted = 0;
    while (state.battle.phase === "ongoing" && accepted < maxActionsPerBattle) {
      let before = state, intentBefore: EnemyIntent | null = null;
      let decision: R2Decision | null = null, policyEvidence: PolicyEvidence | null = null;
      let rawPolicy: unknown = null, executionResult: unknown = null;
      let effects: R2ActionResult["result"] | null = null, defense: R2ActionResult["defense"] = null;
      let actualDefenseReduction = 0, stage: R2ErrorStage = "snapshot";
      try {
        const snapshot = deps.snapshot(copyState(state));
        if (!isDeepStrictEqual(snapshot, state)) throw new R2ValidationError("Snapshot differs from actual state");
        before = snapshot;
        stage = "intent";
        const intent = deps.intent(copyState(before).battle);
        if (!isDeepStrictEqual(intent, getEnemyIntent(before.battle))) throw new R2ValidationError("Invalid enemy intent");
        intentBefore = intent;
        stage = "policy";
        rawPolicy = deps.policy(copyState(before), plan.strategyId, structuredClone(config), plan.policyVersion) ?? null;
        stage = "decision-validation";
        validateDecisionResult(rawPolicy, plan);
        decision = rawPolicy.decision; policyEvidence = rawPolicy.evidence;
        stage = "execution";
        executionResult = deps.execute(copyState(before), decision.action, structuredClone(config)) ?? null;
        stage = "result-validation";
        // Preserve what was returned before checking it; malformed raw values remain diagnostic evidence.
        if (executionResult && typeof executionResult === "object") {
          const observed = executionResult as Partial<R2ActionResult>;
          if (isR2State(observed.state)) state = copyState(observed.state);
          if (observed.result && typeof observed.result === "object") effects = observed.result;
          if (observed.defense && typeof observed.defense === "object") defense = observed.defense;
          if (decision.action === "defend" && effects?.accepted && Number.isFinite(defense?.damagePrevented)) actualDefenseReduction = defense!.damagePrevented;
          if (effects?.accepted === false && isDeepStrictEqual(observed.state, before)
            && isDeepStrictEqual(effects.state, before.battle) && observed.defense === null
            && ["battle-ended", "insufficient-energy", "unknown-action"].includes(effects.reason)) {
            stage = "execution"; throw new R2Rejection(effects.reason);
          }
        }
        deps.validateResult(executionResult, before, decision.action, config);
        const step = executionResult as R2ActionResult;
        if (!step.result.accepted) { stage = "execution"; throw new R2Rejection(step.result.reason); }
        state = copyState(step.state);
        stage = "recording";
        const retainedPolicy = structuredClone(rawPolicy), retainedStep = deps.retainResult(structuredClone(step));
        if (!isDeepStrictEqual(retainedStep, step)) throw new R2ValidationError("Recorded execution differs from actual result");
        actions.push({ before: copyState(before), after: copyState(state), decision: retainedPolicy.decision, intentBefore,
          accepted: true, effects: retainedStep.result, defense: retainedStep.defense, policyEvidence: retainedPolicy.evidence,
          actualDefenseReduction: step.defense?.damagePrevented ?? 0,
          error: null, errorStage: null, errorKind: null, rawPolicy: retainedPolicy, executionResult: retainedStep });
        accepted++;
      } catch (cause) {
        try { error = String(cause instanceof Error ? cause.message || cause.name : cause) || "Empty thrown value"; }
        catch { error = "Unreadable thrown value"; }
        actions.push({ before: copyState(before), after: copyState(state), decision, intentBefore,
          accepted: false, effects, defense, error, policyEvidence, actualDefenseReduction,
          errorStage: stage, errorKind: cause instanceof R2Rejection ? "rejected" : cause instanceof R2ValidationError ? "invalid-output" : "exception", rawPolicy, executionResult });
        break;
      }
    }
    outcome = error !== null ? "error" : state.battle.phase === "ongoing" ? "timeout" : state.battle.phase;
    battles.push({ initial, final: structuredClone(state), outcome, actions });
    if (outcome !== "victory" || encounter === 2) break;
    const upgrade = plan.upgradePath[encounter];
    progress = applyUpgrade(getPlayerProgress(state.battle), upgrade);
    upgrades.push({ upgrade, before: structuredClone(state), after: { battle: startBattle(ENEMIES[encounter + 1], progress), consecutiveDefenses: 0 } });
  }
  return { scenario: plan, mechanism: config, maxActionsPerBattle, battles, upgrades, outcome, error, summary: summarizeR2(battles) };
}
