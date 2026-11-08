import { afterEach, describe, expect, it, vi } from "vitest";
import * as engine from "../lib/game/engine";
import { R2_GROUPS, R1_CONTROL } from "../lib/simulation/r2/config";
import { performR2Action } from "../lib/simulation/r2/mechanics";
import { chooseR2Policy } from "../lib/simulation/r2/policy";
import { runR2Challenge, type R2RunnerDependencies, type R2Scenario } from "../lib/simulation/r2/runner";
import { verifyR2Run } from "../lib/simulation/r2/verify";
import { serializeR2Error, serializeR2Run } from "../lib/simulation/r2/serialize";

const config = R2_GROUPS[0];
const plan: R2Scenario = { strategyId: "A", upgradePath: ["blade", "blade"] };
const failure = (message: string): never => { throw new Error(message); };
afterEach(() => vi.restoreAllMocks());
function last(run: ReturnType<typeof runR2Challenge>) { return run.battles.at(-1)!.actions.at(-1)!; }
function check(run: ReturnType<typeof runR2Challenge>, stage: string, accepted: number, attempts = accepted + 1) {
  expect(run.outcome).toBe("error"); expect(last(run).errorStage).toBe(stage);
  expect(last(run).accepted).toBe(false); expect(run.summary.playerActions).toBe(accepted);
  expect(run.summary.actionAttempts).toBe(attempts);
  expect(() => verifyR2Run(run)).not.toThrow();
  expect(() => serializeR2Run(run)).toThrow("diagnostic");
  expect(JSON.parse(serializeR2Error(run))).toMatchObject({ status: "failed", result: { outcome: "error" } });
}
describe("per-attempt R2 error boundary", () => {
  it.each([["plain fault", "plain fault"], ["", "Empty thrown value"], [Symbol("fault"), "Symbol(fault)"]])("non-Error thrown value %s remains readable", (value, message) => {
    const run = runR2Challenge(plan, config, 200, { policy: () => { throw value; } });
    check(run, "policy", 0); expect(run.error).toBe(message);
  });
  it("unprintable thrown objects still produce an auditable error record", () => {
    const run = runR2Challenge(plan, config, 200, { policy: () => { throw { toString: () => failure("format fault") }; } });
    check(run, "policy", 0); expect(run.error).toBe("Unreadable thrown value");
  });
  it("snapshot failure retains the real initial state without a fabricated decision", () => {
    const run = runR2Challenge(plan, config, 200, { snapshot: () => failure("snapshot fault") });
    check(run, "snapshot", 0);
    expect(last(run)).toMatchObject({ decision: null, policyEvidence: null, effects: null, intentBefore: null, actualDefenseReduction: 0, error: "snapshot fault" });
    expect(last(run).after).toEqual(last(run).before);
  });
  it("getEnemyIntent failure is classified as intent", () => {
    const run = runR2Challenge(plan, config, 200, { intent: () => failure("intent fault") });
    check(run, "intent", 0); expect(last(run).intentBefore).toBeNull();
    expect(last(run).decision).toBeNull(); expect(last(run).error).toBe("intent fault");
  });
  it("direct getEnemyIntent throw is captured, with no policy or execution call", () => {
    const spy = vi.spyOn(engine, "getEnemyIntent").mockImplementationOnce(() => failure("real intent fault"));
    const policy = vi.fn(chooseR2Policy), execute = vi.fn(performR2Action);
    const run = runR2Challenge(plan, config, 200, { policy, execute });
    spy.mockRestore(); check(run, "intent", 0);
    expect(policy).not.toHaveBeenCalled(); expect(execute).not.toHaveBeenCalled();
  });
  it("Compat policy failure retains actual intent but no invented policy fields", () => {
    const run = runR2Challenge(plan, config, 200, { policy: () => failure("compat fault") });
    check(run, "policy", 0); expect(last(run).intentBefore).toEqual({ attackNumber: 1, damage: 9, kind: "normal" });
    expect(last(run).decision).toBeNull(); expect(last(run).policyEvidence).toBeNull();
  });
  it.each(["D", "E"] as const)("Adaptive %s real candidate prediction throw is captured", strategyId => {
    const spy = vi.spyOn(engine, "performAction").mockImplementationOnce(() => failure(`candidate ${strategyId} fault`));
    const execute = vi.fn(performR2Action);
    const run = runR2Challenge({ strategyId, upgradePath: ["armor", "armor"], policyVersion: `R2-adaptive-${strategyId}-v1` }, config, 200, { execute });
    expect(spy).toHaveBeenCalled(); spy.mockRestore();
    check(run, "policy", 0); expect(execute).not.toHaveBeenCalled();
    expect(last(run).error).toBe(`candidate ${strategyId} fault`);
  });
  it.each(["invalid-action", "missing-evidence", "missing-decision", "wrong-version", "undefined-result"])("invalid policy structure %s never executes", kind => {
    const execute = vi.fn(performR2Action);
    const policy: R2RunnerDependencies["policy"] = (...args) => {
      const raw = structuredClone(chooseR2Policy(...args));
      if (kind === "invalid-action") Object.assign(raw.decision, { action: "invalid" });
      if (kind === "missing-evidence") Object.assign(raw, { evidence: null });
      if (kind === "missing-decision") Object.assign(raw, { decision: null });
      if (kind === "wrong-version") Object.assign(raw.decision, { strategyVersion: "R2-compat-F-v1" });
      return kind === "undefined-result" ? undefined : raw;
    };
    const run = runR2Challenge(plan, config, 200, { policy, execute });
    check(run, "decision-validation", 0); expect(execute).not.toHaveBeenCalled();
    expect(last(run).decision).toBeNull(); expect(last(run).policyEvidence).toBeNull();
    if (kind === "invalid-action") expect(last(run).rawPolicy).toMatchObject({ decision: { action: "invalid" } });
  });
  it("performR2Action throw preserves the valid decision and policy evidence", () => {
    const execute = vi.fn(() => failure("execution fault"));
    const run = runR2Challenge(plan, config, 200, { execute }); check(run, "execution", 0);
    expect(execute).toHaveBeenCalledTimes(1); expect(last(run).decision?.action).toBe("attack");
    expect(last(run).policyEvidence).not.toBeNull(); expect(last(run).effects).toBeNull();
    expect(last(run).after).toEqual(last(run).before);
  });
  it("returned rejection is retained as an observed rejection, never retried", () => {
    const execute = vi.fn((state: Parameters<typeof performR2Action>[0]) => ({ state, result: { accepted: false, state: state.battle, reason: "insufficient-energy" }, defense: null }));
    const run = runR2Challenge(plan, config, 200, { execute }); check(run, "execution", 0);
    expect(execute).toHaveBeenCalledTimes(1); expect(last(run).effects).toMatchObject({ accepted: false, reason: "insufficient-energy" });
    expect(run.summary.enemyAttacks).toBe(0); expect(run.summary.attackCount).toBe(0);
  });
  it.each(["policy", "intent", "snapshot", "execution"] as const)("late %s failure preserves five accepted actions across an upgrade", stage => {
    const baseline = runR2Challenge(plan, config);
    let calls = 0;
    const deps: { -readonly [K in keyof R2RunnerDependencies]?: R2RunnerDependencies[K] } = {};
    if (stage === "policy") deps.policy = (...args) => ++calls === 6 ? failure("late policy fault") : chooseR2Policy(...args);
    if (stage === "intent") deps.intent = s => ++calls === 6 ? failure("late intent fault") : engine.getEnemyIntent(s);
    if (stage === "snapshot") deps.snapshot = s => ++calls === 6 ? failure("late snapshot fault") : structuredClone(s);
    if (stage === "execution") deps.execute = (...args) => ++calls === 6 ? failure("late execution fault") : performR2Action(...args);
    const run = runR2Challenge(plan, config, 200, deps); check(run, stage, 5);
    expect(calls).toBe(6); expect(run.summary.startedBattles).toBe(2); expect(run.summary.completedBattles).toBe(1);
    expect(run.upgrades).toEqual(baseline.upgrades.slice(0, 1));
    const prior = run.battles.flatMap(b => b.actions).slice(0, 5);
    expect(prior).toEqual(baseline.battles.flatMap(b => b.actions).slice(0, 5));
    expect(last(run).before).toEqual(prior.at(-1)!.after);
    expect(last(run).after).toEqual(last(run).before);
    expect(run.summary.attackCount).toBe(5); expect(run.summary.enemyAttacks).toBe(4);
    if (stage === "execution") {
      expect(run.summary.finalHp).toBeNull(); expect(run.summary.finalEnergy).toBeNull();
      expect(run.summary.finalHpAvailable).toBe(false); expect(run.summary.finalHpVerified).toBe(false);
    } else {
      expect(run.summary.finalHp).toBe(60); expect(run.summary.finalHpAvailable).toBe(true);
      expect(run.summary.finalHpVerified).toBe(true);
    }
    expect(run.summary.rawHpLoss).toBe(40);
  });
  it("accepted execution followed by invalid effects preserves actual state and returned result", () => {
    const execute = vi.fn((...args: Parameters<typeof performR2Action>) => {
      const actual = structuredClone(performR2Action(...args));
      if (actual.result.accepted) Object.assign(actual.result.effects, { damageTaken: 999 });
      return actual;
    });
    const run = runR2Challenge(plan, config, 200, { execute }); check(run, "result-validation", 0);
    expect(execute).toHaveBeenCalledTimes(1);
    expect(last(run).accepted).toBe(false); expect(last(run).effects).toMatchObject({ accepted: true, effects: { damageTaken: 999 } });
    expect(last(run).before.battle.player.hp).toBe(100); expect(last(run).after.battle.player.hp).toBe(91);
    expect(last(run).after.battle.enemy.hp).toBe(30); expect(run.summary.finalHp).toBe(91);
    expect(run.summary.rawHpLoss).toBe(0); // no unvalidated step counted as an accepted result
  });
  it("recording failure after a real accepted action retains execution evidence without retry", () => {
    const execute = vi.fn(performR2Action);
    const run = runR2Challenge(plan, config, 200, { execute, retainResult: () => failure("recording fault") });
    check(run, "recording", 0); expect(execute).toHaveBeenCalledTimes(1);
    expect(last(run).effects?.accepted).toBe(true); expect(last(run).after.battle.player.hp).toBe(91);
    expect(last(run).executionResult).not.toBeNull();
  });
  it("a transient validator exception preserves a valid executed result as failure evidence", () => {
    const run = runR2Challenge(plan, config, 200, { validateResult: () => failure("validator unavailable") });
    check(run, "result-validation", 0);
    expect(last(run).errorKind).toBe("exception"); expect(last(run).effects?.accepted).toBe(true);
    expect(last(run).after.battle.player.hp).toBe(91);
  });
  it("late result-validation failure leaves the entire valid prefix byte-equivalent", () => {
    const baseline = runR2Challenge(plan, config); let calls = 0;
    const run = runR2Challenge(plan, config, 200, { execute: (...args) => {
      const result = structuredClone(performR2Action(...args));
      if (++calls === 6) Object.assign(result, { defense: { multiplier: 1, reductionAvailable: 12, damagePrevented: 0, energySpent: 999, energyGained: 0 } });
      return result;
    } });
    check(run, "result-validation", 5);
    expect(JSON.stringify(run.battles.flatMap(b => b.actions).slice(0, 5))).toBe(JSON.stringify(baseline.battles.flatMap(b => b.actions).slice(0, 5)));
    expect(last(run).effects?.accepted).toBe(true); expect(last(run).after.battle.player.hp).toBe(47);
    expect(run.summary.rawHpLoss).toBe(40); expect(run.summary.finalHp).toBe(47);
  });
  it("undefined execution output is a result-validation failure without invented effects", () => {
    const run = runR2Challenge(plan, config, 200, { execute: () => undefined }); check(run, "result-validation", 0);
    expect(last(run).effects).toBeNull(); expect(last(run).after).toEqual(last(run).before);
    expect(run.battles.at(-1)?.finalStateAvailable).toBe(false);
    expect(run.summary.finalHpAvailable).toBe(false);
    expect(run.summary.finalHpVerified).toBe(false);
    expect(run.summary.finalHp).toBeNull();
    expect(run.summary.finalEnergy).toBeNull();
  });
  it("non-finite raw execution is retained in memory and explicitly refused by JSON serialization", () => {
    const run = runR2Challenge(plan, config, 200, { execute: (...args) => {
      const result = structuredClone(performR2Action(...args)); Object.assign(result.state.battle.player, { hp: NaN }); return result;
    } });
    expect(run.outcome).toBe("error"); expect(last(run).errorStage).toBe("result-validation");
    expect(() => verifyR2Run(run)).not.toThrow(); expect(last(run).executionResult).not.toBeNull();
    expect(() => serializeR2Error(run)).toThrow("finite");
  });
});
describe("error evidence verification and completion separation", () => {
  function broken() { let n = 0; return runR2Challenge(plan, config, 200, { policy: (...args) => ++n === 3 ? failure("third action policy fault") : chooseR2Policy(...args) }); }
  it.each(["before", "after", "intent", "decision", "evidence", "stage", "effects", "reduction", "summary", "run-error", "prefix", "missing-error", "extra-upgrade", "extra-action", "fake-normal"])("rejects error evidence tampering: %s", kind => {
    const run = structuredClone(broken()), step = last(run);
    if (kind === "before") Object.assign(step.before.battle.player, { hp: 1 });
    if (kind === "after") Object.assign(step.after.battle.player, { hp: 1 });
    if (kind === "intent") Object.assign(step, { intentBefore: null });
    if (kind === "decision") Object.assign(step, { decision: run.battles[0].actions[0].decision });
    if (kind === "evidence") Object.assign(step, { policyEvidence: run.battles[0].actions[0].policyEvidence });
    if (kind === "stage") Object.assign(step, { errorStage: "intent" });
    if (kind === "effects") Object.assign(step, { effects: run.battles[0].actions[0].effects });
    if (kind === "reduction") Object.assign(step, { actualDefenseReduction: 12 });
    if (kind === "summary") run.summary.playerActions++;
    if (kind === "run-error") Object.assign(run, { error: "different error" });
    if (kind === "prefix") Object.assign(run.battles[0].actions[0].after.battle.enemy, { hp: 999 });
    if (kind === "missing-error") (run.battles[0].actions as unknown[]).pop();
    if (kind === "extra-upgrade") (run.upgrades as unknown[]).push({});
    if (kind === "extra-action") (run.battles[0].actions as unknown[]).push(run.battles[0].actions[0]);
    if (kind === "fake-normal") { Object.assign(run, { outcome: "timeout", error: null }); Object.assign(run.battles[0], { outcome: "timeout" }); }
    expect(() => verifyR2Run(run)).toThrow();
  });
  it("cannot relabel a valid execution as a result-validation failure", () => {
    const run = structuredClone(runR2Challenge(plan, config, 1));
    Object.assign(run, { outcome: "error", error: "fake failure" }); Object.assign(run.battles[0], { outcome: "error" });
    Object.assign(last(run), { accepted: false, error: "fake failure", errorStage: "result-validation", errorKind: "invalid-output" });
    expect(() => verifyR2Run(run)).toThrow("mislabeled");
  });
  it("cannot relabel valid policy output as a decision-validation failure", () => {
    const run = structuredClone(runR2Challenge(plan, config, 200, { policy: () => failure("policy fault") }));
    Object.assign(last(run), { errorStage: "decision-validation", errorKind: "invalid-output", rawPolicy: chooseR2Policy(last(run).before, "A", config) });
    expect(() => verifyR2Run(run)).toThrow("mislabeled");
  });
  it.each(["victory", "defeat", "timeout"] as const)("normal %s remains a strict completed trace", outcome => {
    const run = outcome === "victory" ? runR2Challenge({ strategyId: "E", upgradePath: ["armor", "armor"] }, R1_CONTROL)
      : runR2Challenge(plan, config, outcome === "timeout" ? 1 : 200);
    expect(run.outcome).toBe(outcome); verifyR2Run(run); expect(() => serializeR2Run(run)).not.toThrow();
    expect(() => serializeR2Error(run)).toThrow("failed");
    for (const a of run.battles.flatMap(b => b.actions)) expect(a).toMatchObject({ accepted: true, error: null, errorStage: null });
  });
});


describe("integrity regressions from independent audit", () => {
  it("uses nested result.state as observed post-action state when wrapper state is missing", () => {
    const execute = (...args: Parameters<typeof performR2Action>) => {
      const actual = performR2Action(...args);
      const { state: _omitted, ...malformed } = actual;
      return malformed;
    };
    const run = runR2Challenge(plan, config, 200, { execute });
    const step = last(run);
    expect(run.outcome).toBe("error");
    expect(step.engineAccepted).toBe(true);
    expect(step.accepted).toBe(false);
    expect(step.stateSource).toBe("result");
    expect(step.after.battle.player.hp).toBe(91);
    expect(run.battles.at(-1)?.finalStateAvailable).toBe(true);
    expect(run.summary.finalHp).toBe(91);
    expect(run.summary.observedRawHpLoss).toBe(9);
    expect(run.summary.acceptedUnverifiedActions).toBe(1);
    expect(run.summary.verifiedActions).toBe(0);
    expect(() => verifyR2Run(run)).not.toThrow();
  });

  it("separates engine acceptance from verification when validator throws after execution", () => {
    const actual = performR2Action;
    const run = runR2Challenge(plan, config, 200, {
      execute: (...args) => actual(...args),
      validateResult: () => failure("validator unavailable")
    });
    expect(last(run).engineAccepted).toBe(true);
    expect(last(run).accepted).toBe(false);
    expect(run.summary.engineAcceptedActions).toBe(1);
    expect(run.summary.verifiedActions).toBe(0);
    expect(run.summary.acceptedUnverifiedActions).toBe(1);
    expect(run.summary.observedRawHpLoss).toBe(9);
    expect(run.summary.rawHpLoss).toBe(0);
    expect(run.summary.finalHp).toBe(91);
    expect(run.summary.finalHpAvailable).toBe(true);
    expect(run.summary.finalHpVerified).toBe(false);
    expect(() => verifyR2Run(run)).not.toThrow();
  });

  it("rejects a non-enumerable toJSON hook instead of silently replacing raw policy evidence", () => {
    const policy = (...args: Parameters<typeof chooseR2Policy>) => {
      const raw = structuredClone(chooseR2Policy(...args));
      Object.assign(raw.decision, { action: "illegal-action" });
      Object.defineProperty(raw, "toJSON", { enumerable: false, value: () => ({ redacted: true }) });
      return raw;
    };
    const run = runR2Challenge(plan, config, 200, { policy });
    expect(run.outcome).toBe("error");
    expect(last(run).rawPolicy).toHaveProperty("decision.action", "illegal-action");
    expect(() => serializeR2Error(run)).toThrow("toJSON");
  });
});
