import { isDeepStrictEqual } from "node:util";
import { GAME_CONFIG } from "../../../data/game-config";
import { applyUpgrade, createInitialProgress, getEnemyIntent, getPlayerProgress, startBattle } from "../../game/engine";
import { validateMechanism } from "./config";
import { performR2Action, type R2State } from "./mechanics";
import { isR2State, validateDecisionResult, validateExecutionResult, validateScenario, type R2Run, type R2Trace } from "./runner";
import { chooseR2Policy } from "./policy";
import { summarizeR2 } from "./statistics";

function same(actual: unknown, expected: unknown, label: string) {
  if (!isDeepStrictEqual(actual, expected)) throw new TypeError(`R2 trace mismatch: ${label}`);
}
/** Reject values JSON would silently lose or transform. */
export function assertR2Json(value: unknown): void {
  const stack = new Set<object>();
  const visit = (item: unknown): void => {
    if (item === null || typeof item === "string" || typeof item === "boolean") return;
    if (typeof item === "number" && Number.isFinite(item)) return;
    if (typeof item !== "object" || stack.has(item)) throw new TypeError("R2 requires finite, acyclic JSON values");
    if (Object.getOwnPropertySymbols(item).length) throw new TypeError("R2 forbids Symbol metadata");
    if (!Array.isArray(item) && Object.getPrototypeOf(item) !== Object.prototype) throw new TypeError("R2 requires plain objects");
    if (Array.isArray(item) && Object.getPrototypeOf(item) !== Array.prototype) throw new TypeError("R2 requires standard arrays");
    const names = Object.getOwnPropertyNames(item);
    if (names.includes("toJSON")) throw new TypeError("R2 forbids custom toJSON hooks");
    stack.add(item);
    if (Array.isArray(item)) {
      for (const name of names) {
        if (name === "length") continue;
        if (!/^(0|[1-9]\d*)$/.test(name) || Number(name) >= item.length) throw new TypeError("R2 forbids non-index array properties");
      }
      for (let i = 0; i < item.length; i++) {
        const descriptor = Object.getOwnPropertyDescriptor(item, String(i));
        if (!descriptor || !descriptor.enumerable || !("value" in descriptor)) throw new TypeError("R2 requires dense data arrays");
        visit(descriptor.value);
      }
    } else {
      for (const name of names) {
        const descriptor = Object.getOwnPropertyDescriptor(item, name)!;
        if (!descriptor.enumerable || !("value" in descriptor)) throw new TypeError("R2 requires enumerable data properties");
        visit(descriptor.value);
      }
    }
    stack.delete(item);
  };
  visit(value);
}
/** Validate a failed attempt as evidence, never as a successful engine transition.
 * Transient exceptions cannot be independently authenticated; their stage and all observable
 * inputs/outputs can. Raw invalid outputs remain available, including non-JSON values.
 */
function verifyErrorStep(trace: R2Trace, before: R2State, run: R2Run): R2State {
  if (trace.accepted || typeof trace.error !== "string" || !trace.error.length
    || !["exception", "invalid-output", "rejected"].includes(trace.errorKind!)
    || !["snapshot", "intent", "policy", "decision-validation", "execution", "result-validation", "recording"].includes(trace.errorStage!)) throw new TypeError("Invalid failed step");
  if (trace.errorKind === "rejected" && trace.errorStage !== "execution") throw new TypeError("Rejected action has incompatible error stage");
  same(trace.before, before, "error before");
  if (trace.errorStage === "snapshot" || trace.errorStage === "intent") same(trace.intentBefore, null, "unavailable intent");
  else same(trace.intentBefore, getEnemyIntent(before.battle), "error intent");
  const early = ["snapshot", "intent", "policy", "decision-validation"].includes(trace.errorStage!);
  if (early) {
    same(trace.decision, null, "no valid decision"); same(trace.policyEvidence, null, "no valid evidence");
    if (trace.errorStage === "decision-validation") {
      let failed = false;
      try { validateDecisionResult(trace.rawPolicy, run.scenario); } catch { failed = true; }
      if (!failed && trace.errorKind === "invalid-output") throw new TypeError("Valid policy mislabeled as decision validation failure");
    } else same(trace.rawPolicy, null, "policy unavailable");
    same(trace.executionResult, null, "execution not started"); same(trace.effects, null, "no effects");
    same(trace.defense, null, "no defense"); same(trace.actualDefenseReduction, 0, "no reduction");
    same(trace.engineAccepted, null, "no engine acceptance"); same(trace.stateSource, "before", "pre-execution state source");
    same(trace.after, before, "unexecuted error after");
    return before;
  }
  const expectedPolicy = chooseR2Policy(before, run.scenario.strategyId, run.mechanism, run.scenario.policyVersion);
  same(trace.decision, expectedPolicy.decision, "error decision"); same(trace.policyEvidence, expectedPolicy.evidence, "error evidence");
  same(trace.rawPolicy, expectedPolicy, "error raw policy");
  if (trace.errorStage === "execution" && trace.executionResult === null) {
    same(trace.errorKind, "exception", "execution exception kind");
    same(trace.after, before, "execution threw without result"); same(trace.effects, null, "no returned effects");
    same(trace.engineAccepted, null, "no engine acceptance"); same(trace.stateSource, "unavailable", "no execution state");
    same(trace.defense, null, "no returned defense"); same(trace.actualDefenseReduction, 0, "no returned reduction"); return before;
  }
  const raw = trace.executionResult as Partial<ReturnType<typeof performR2Action>> | null;
  const observed = raw && typeof raw === "object" ? raw : null;
  const effects = observed?.result && typeof observed.result === "object" ? observed.result : null;
  const engineAccepted = typeof effects?.accepted === "boolean" ? effects.accepted : null;
  const nestedBattle = effects?.state;
  const inferredStreak = engineAccepted === true
    ? trace.decision?.action === "defend" ? before.consecutiveDefenses + 1 : 0
    : before.consecutiveDefenses;
  const nestedState = engineAccepted !== null && nestedBattle && typeof nestedBattle === "object"
    ? { battle: nestedBattle, consecutiveDefenses: inferredStreak } : null;
  const after = isR2State(observed?.state) ? observed!.state!
    : isR2State(nestedState) ? nestedState : before;
  const source = isR2State(observed?.state) ? "outer"
    : isR2State(nestedState) ? "result"
    : observed || trace.errorStage === "result-validation" ? "unavailable" : "before";
  same(trace.engineAccepted, engineAccepted, "engine accepted");
  same(trace.stateSource, source, "state evidence source");
  const defense = observed?.defense && typeof observed.defense === "object" ? observed.defense : null;
  same(trace.after, after, "observed error after"); same(trace.effects, effects, "observed error effects"); same(trace.defense, defense, "observed error defense");
  same(trace.actualDefenseReduction, trace.decision?.action === "defend" && effects?.accepted && Number.isFinite(defense?.damagePrevented) ? defense!.damagePrevented : 0, "observed reduction");
  if (trace.errorStage === "execution") {
    same(trace.errorKind, "rejected", "rejection kind");
    same(trace.engineAccepted, false, "rejected engine action");
    if (!effects || effects.accepted !== false || !["battle-ended", "insufficient-energy", "unknown-action"].includes(effects.reason)) throw new TypeError("Invalid rejected execution evidence");
    same(after, before, "rejected state"); same(effects.state, before.battle, "rejected result state");
    same(trace.defense, null, "rejected defense"); same(trace.error, effects.reason, "rejection reason");
  } else if (trace.errorStage === "result-validation") {
    let invalid = false;
    try { validateExecutionResult(trace.executionResult, before, expectedPolicy.decision.action, run.mechanism); } catch { invalid = true; }
    if (!invalid && trace.errorKind === "invalid-output") throw new TypeError("Valid execution mislabeled as result validation failure");
  } else {
    validateExecutionResult(trace.executionResult, before, expectedPolicy.decision.action, run.mechanism);
  }
  return after;
}
/** Rebuild every transition, strategy choice and upgrade from real initial progress.
 * It consumes an existing trace, never executes a new matrix or trusts endpoints.
 */
export function verifyR2Run(run: R2Run): void {
  // Failed raw outputs may not be JSON-representable. Never silently discard them:
  // verify their observable relationships below; serialization separately rejects lossy values.
  assertR2Json({ ...run, battles: run.battles.map(b => ({ ...b, actions: b.actions.map(a => a.accepted ? a
    : { ...a, rawPolicy: null, executionResult: null, effects: null, defense: null }) })) });
  validateScenario(run.scenario); validateMechanism(run.mechanism);
  if (!Number.isSafeInteger(run.maxActionsPerBattle) || run.maxActionsPerBattle < 1) throw new TypeError("Invalid R2 limit");
  if (run.outcome === "error" ? typeof run.error !== "string" || !run.error.length : run.error !== null) throw new TypeError("Invalid challenge error metadata");
  if (!Array.isArray(run.battles) || run.battles.length < 1 || run.battles.length > 3 || !Array.isArray(run.upgrades)) throw new TypeError("Invalid R2 battles");
  let expected: R2State = { battle: startBattle("light", createInitialProgress()), consecutiveDefenses: 0 };
  const enemies = ["light", "heavy", "boss"] as const;
  let upgrades = 0;
  let sawError = false;
  for (let bi = 0; bi < run.battles.length; bi++) {
    const b = run.battles[bi]; same(b.initial, expected, `battle ${bi} initial`);
    let count = 0;
    for (const [ai, trace] of b.actions.entries()) {
      if (expected.battle.phase !== "ongoing" || count >= run.maxActionsPerBattle) throw new TypeError("Action after terminal/limit");
      same(trace.before, expected, `before ${bi}/${ai}`);
      if (!trace.accepted) {
        if (sawError || bi !== run.battles.length - 1 || ai !== b.actions.length - 1
          || b.outcome !== "error" || run.outcome !== "error") throw new TypeError("Error must terminate the challenge immediately");
        expected = verifyErrorStep(trace, expected, run); same(run.error, trace.error, "challenge error message");
        sawError = true; break;
      }
      const { decision, evidence } = chooseR2Policy(expected, run.scenario.strategyId, run.mechanism, run.scenario.policyVersion);
      same(trace.decision, decision, `strategy ${bi}/${ai}`);
      same(trace.policyEvidence, evidence, `policy evidence ${bi}/${ai}`);
      same(trace.intentBefore, getEnemyIntent(expected.battle), `intent ${bi}/${ai}`);
      const step = performR2Action(expected, decision.action, run.mechanism);
      if (!step.result.accepted) throw new TypeError("Rejected action cannot be a completed R2 trace");
      same(trace.accepted, true, "accepted"); same(trace.engineAccepted, true, "engine accepted");
      same(trace.stateSource, "outer", "verified outer state"); same(trace.error, null, "error");
      same(trace.errorStage, null, "successful stage");
      same(trace.errorKind, null, "successful error kind");
      same(trace.rawPolicy, { decision, evidence }, "successful raw policy");
      same(trace.executionResult, step, "successful execution evidence");
      same(trace.effects, step.result, "effects"); same(trace.defense, step.defense, "defense");
      same(trace.actualDefenseReduction, step.defense?.damagePrevented ?? 0, "actual defense reduction");
      // Cross-check execution count against the actual attack effect, not preview intent.
      same(step.state.battle.enemyAttacksExecuted - expected.battle.enemyAttacksExecuted,
        step.result.effects.enemyIntent === null ? 0 : 1, "enemy attack increment");
      expected = step.state; same(trace.after, expected, `after ${bi}/${ai}`); count++;
    }
    same(b.final, expected, "battle final");
    if (!sawError) same(b.finalStateAvailable, true, "successful final state available");
    else same(b.finalStateAvailable, b.actions.at(-1)?.stateSource !== "unavailable", "failed final state confidence");
    const outcome = sawError ? "error" : expected.battle.phase === "ongoing" ? "timeout" : expected.battle.phase;
    same(b.outcome, outcome, "battle outcome");
    if (outcome === "timeout" && count !== run.maxActionsPerBattle) throw new TypeError("Premature timeout");
    const last = bi === run.battles.length - 1;
    if (!last && outcome !== "victory") throw new TypeError("Battle after failure");
    if (last) {
      same(run.outcome, outcome, "challenge outcome");
      if (outcome === "victory" && bi !== 2) throw new TypeError("Premature challenge victory");
    } else {
      const upgrade = run.scenario.upgradePath[bi];
      const next = { battle: startBattle(enemies[bi + 1], applyUpgrade(getPlayerProgress(expected.battle), upgrade)), consecutiveDefenses: 0 };
      same(run.upgrades[upgrades++], { upgrade, before: expected, after: next }, "upgrade inheritance/reset");
      expected = next;
    }
  }
  same(run.upgrades.length, upgrades, "extra/missing upgrade");
  same(run.outcome === "error", sawError, "missing error step");
  same(run.summary, summarizeR2(run.battles), "independently derived statistics");
}
export const R2_BASE_CONFIG = GAME_CONFIG;
