import { describe, expect, it } from "vitest";
import { startBattle } from "../lib/game/engine";
import { R2_GROUPS } from "../lib/simulation/r2/config";
import { performR2Action, type R2State } from "../lib/simulation/r2/mechanics";
import { assessR2Actions, chooseAdaptiveAction, type AdaptiveVersion } from "../lib/simulation/r2/adaptive-strategies";
import { chooseR2Action } from "../lib/simulation/r2/strategies";
import { chooseR2Policy, type R2PolicyVersion } from "../lib/simulation/r2/policy";
import { runR2Challenge } from "../lib/simulation/r2/runner";
import { serializeR2Run } from "../lib/simulation/r2/serialize";
import { verifyR2Run } from "../lib/simulation/r2/verify";
import type { StrategyId } from "../lib/simulation/types";

const [A, B, C, D] = R2_GROUPS;
const AD = "R2-adaptive-D-v1", AE = "R2-adaptive-E-v1";
function sample(hp = 100, energy = 2, streak = 0, armor = 2, special = false): R2State {
  const battle = startBattle("boss", { hp, upgrades: { blade: 0, core: 0, armor } });
  return { battle: { ...battle, player: { ...battle.player, energy }, enemyAttacksExecuted: special ? 2 : 0 }, consecutiveDefenses: streak };
}
describe("explicit adaptive decisions", () => {
  it("D changes from saving defense to attack when actual decay no longer saves", () => {
    const first = sample(7, 0, 0), exhausted = sample(7, 0, 4);
    expect(chooseAdaptiveAction(first, AD, C).decision.action).toBe("defend");
    expect(chooseR2Action(exhausted, "D", C).action).toBe("defend");
    expect(chooseAdaptiveAction(exhausted, AD, C).decision.action).toBe("attack");
    expect(chooseAdaptiveAction(exhausted, AD, C).evidence.defenseDamagePreventable).toBe(0);
  });
  it.each([AD, AE] as AdaptiveVersion[])("%s protects against a lethal special with useful affordable defense", version => {
    const s = sample(15, 2, 0, 1, true), selected = chooseAdaptiveAction(s, version, D);
    expect(selected.decision.action).toBe("defend");
    expect(selected.evidence.reason).toBe("saving-defense");
    expect(performR2Action(s, selected.decision.action, D).state.battle.player.hp).toBe(11);
  });
  it("E restores resources instead of taking zero-benefit exhausted defense", () => {
    const decision = chooseAdaptiveAction(sample(100, 0, 4), AE, C);
    expect(decision.decision.action).toBe("charge"); expect(decision.evidence.reason).toBe("restore-heavy-energy");
  });
  it("E proactively defends a special when it preserves the next Heavy resource", () => {
    expect(chooseAdaptiveAction(sample(100, 2, 0, 1, true), AE, A).decision.action).toBe("defend");
    expect(chooseAdaptiveAction(sample(100, 2, 0, 1, true), AE, B).decision.action).toBe("heavy");
    expect(chooseAdaptiveAction(sample(100, 3, 0, 1, true), AE, B).decision.action).toBe("defend");
  });
  it("E declines an exhausted special defense even with energy available", () => {
    expect(chooseAdaptiveAction(sample(100, 4, 4, 2, true), AE, D).decision.action).toBe("heavy");
  });
  it.each([AD, AE] as AdaptiveVersion[])("%s records unaffordable saving defense and a legal charge fallback", version => {
    const selection = chooseAdaptiveAction(sample(7, 0), version, B);
    expect(selection.decision).toEqual({ strategyVersion: version, originalIntent: "defend", action: "charge", fallbackReason: "defense-insufficient-energy" });
    expect(selection.evidence.defenseAffordable).toBe(false);
    expect(selection.evidence.candidates.some(c => c.action === "defend")).toBe(false);
  });
  it.each([AD, AE] as AdaptiveVersion[])("%s kills before shielding and suppresses the special counterattack", version => {
    const s = sample(1, 2, 0, 2, true);
    const low = { ...s, battle: { ...s.battle, enemy: { ...s.battle.enemy, hp: 10 } } };
    const chosen = chooseAdaptiveAction(low, version, D);
    expect(chosen.decision.action).toBe("attack");
    expect(performR2Action(low, chosen.decision.action, D).result).toMatchObject({ accepted: true, effects: { enemyIntent: null } });
  });
  it("E chooses a legal output when every action is fatal and mitigation is exhausted", () => {
    expect(chooseAdaptiveAction(sample(1, 2, 4), AE, D).decision.action).toBe("heavy");
  });
  it("paid defense can produce Heavy/Charge cycling without any defense", () => {
    let state = sample(200, 2, 0, 0); const actions = [];
    for (let i = 0; i < 6; i++) {
      const selected = chooseAdaptiveAction(state, AE, B); actions.push(selected.decision.action);
      state = performR2Action(state, selected.decision.action, B).state;
    }
    expect(actions).toEqual(["heavy", "charge", "heavy", "charge", "heavy", "charge"]);
  });
  it("documents that free nondecaying defense can still have no progress at low HP", () => {
    const s = sample(7, 0), selected = chooseAdaptiveAction(s, AE, A);
    const next = performR2Action(s, selected.decision.action, A).state;
    expect(next.battle.player.hp).toBe(7); expect(next.battle.player.energy).toBe(0);
    expect(next.battle.enemy.hp).toBe(120);
    expect(chooseAdaptiveAction(next, AE, A).decision.action).toBe("defend");
  });
  it.each(R2_GROUPS)("$id candidate forecasts equal actual adapter results, including fractional decay", config => {
    const s = sample(13, 3, 1, 1, true);
    for (const candidate of assessR2Actions(s, config).candidates) {
      const step = performR2Action(s, candidate.action, config);
      expect(step.result.accepted).toBe(true);
      expect(candidate.hpAfter).toBe(step.state.battle.player.hp);
      expect(candidate.energyAfter).toBe(step.state.battle.player.energy);
      expect(candidate.survives).toBe(step.state.battle.phase !== "defeat");
    }
  });
  it("decision calculation never mutates state or consumes actual execution counters", () => {
    const s = sample(), copy = structuredClone(s); chooseAdaptiveAction(s, AE, C); expect(s).toEqual(copy);
  });
  it("rejects unknown or mismatched policy versions and terminal decision input", () => {
    expect(() => chooseR2Policy(sample(), "A", A, AE)).toThrow();
    expect(() => chooseR2Policy(sample(), "E", A, "R2-compat-D-v1")).toThrow();
    expect(() => chooseAdaptiveAction(sample(), "unknown" as AdaptiveVersion, A)).toThrow();
    const s = sample(); expect(() => chooseAdaptiveAction({ ...s, battle: { ...s.battle, phase: "defeat" } }, AE, A)).toThrow();
  });
});
const policies: readonly [StrategyId, R2PolicyVersion | undefined][] = [
  ["A", undefined], ["B", undefined], ["C", undefined], ["D", undefined], ["E", undefined], ["F", undefined], ["D", AD], ["E", AE],
];
describe("bounded integration samples, not a full experiment", () => {
  for (const config of R2_GROUPS) {
    it.each(policies)(`${config.id} legal policy %s/%s for three Light actions only`, (strategyId, policyVersion) => {
      const scenario = { strategyId, upgradePath: ["armor", "core"] as const,
        ...(policyVersion ? { policyVersion } : {}) };
      const run = runR2Challenge(scenario, config, 3);
      expect(run.outcome).not.toBe("error"); verifyR2Run(run);
      for (const battle of run.battles) for (const a of battle.actions) {
        if (!a.accepted) throw new Error("Expected successful sample action");
        expect(a.accepted).toBe(true); expect(a.policyEvidence.consecutiveDefensesBefore).toBe(a.before.consecutiveDefenses);
        expect(a.policyEvidence.defenseCost).toBe(config.defenseCost);
        expect(a.actualDefenseReduction).toBe(a.defense?.damagePrevented ?? 0);
      }
      expect(JSON.parse(serializeR2Run(run)).result).toEqual(run);
    });
  }
  it.each(["cost", "streak", "actual-reduction", "candidate", "reason", "version"])("replay rejects changed %s evidence", kind => {
    const run = structuredClone(runR2Challenge({ strategyId: "E", upgradePath: ["armor", "armor"], policyVersion: AE }, C, 3));
    const a = run.battles[0].actions[0];
    if (!a.accepted) throw new Error("Expected successful source trace");
    if (kind === "cost") Object.assign(a.policyEvidence, { defenseCost: 99 });
    if (kind === "streak") Object.assign(a.policyEvidence, { consecutiveDefensesBefore: 99 });
    if (kind === "actual-reduction") Object.assign(a, { actualDefenseReduction: 99 });
    if (kind === "candidate") Object.assign(a.policyEvidence.candidates[0], { hpAfter: 999 });
    if (kind === "reason") Object.assign(a.policyEvidence, { reason: "fabricated" });
    if (kind === "version") Object.assign(a.decision, { strategyVersion: "R2-compat-E-v1" });
    expect(() => verifyR2Run(run)).toThrow();
  });
  it("explicit compat version preserves the original decision exactly", () => {
    const s = sample(7, 0, 4);
    expect(chooseR2Policy(s, "D", D, "R2-compat-D-v1").decision).toEqual(chooseR2Action(s, "D", D));
  });
  it("normalizes an explicitly undefined optional version without mutating input", () => {
    const scenario = { strategyId: "E" as const, upgradePath: ["armor", "armor"] as const, policyVersion: undefined };
    const run = runR2Challenge(scenario, A, 1);
    expect(Object.hasOwn(run.scenario, "policyVersion")).toBe(false);
    expect(Object.hasOwn(scenario, "policyVersion")).toBe(true);
    expect(() => serializeR2Run(run)).not.toThrow();
  });
});
