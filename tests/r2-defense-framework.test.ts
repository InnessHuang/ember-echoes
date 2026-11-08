import { describe, expect, it, vi, afterEach } from "vitest";
import { GAME_CONFIG } from "../data/game-config";
import { createInitialProgress, performAction, startBattle } from "../lib/game/engine";
import type { ActionId, EnemyId } from "../lib/game/types";
import { R1_CONTROL, R2_GROUPS, validateMechanism } from "../lib/simulation/r2/config";
import { performR2Action, type R2State } from "../lib/simulation/r2/mechanics";
import * as mechanics from "../lib/simulation/r2/mechanics";
import { chooseR2Action } from "../lib/simulation/r2/strategies";
import { R2_SCENARIOS, runR2Challenge } from "../lib/simulation/r2/runner";
import { assertR2Json, verifyR2Run } from "../lib/simulation/r2/verify";
import { serializeR2Run } from "../lib/simulation/r2/serialize";
import { runChallengeDiagnostics } from "../lib/simulation/run-challenge-diagnostics-r1";

const [A, B, C, D] = R2_GROUPS;
const scenario = { strategyId: "E" as const, upgradePath: ["armor", "armor"] as const };
function state(enemy: EnemyId = "boss", armor = 0, energy = 2, streak = 0): R2State {
  const battle = startBattle(enemy, { hp: 200, upgrades: { blade: 0, core: 0, armor } });
  return { battle: { ...battle, player: { ...battle.player, energy } }, consecutiveDefenses: streak };
}
afterEach(() => vi.restoreAllMocks());
describe("isolated R2 defense mechanisms", () => {
  it("defines the exact 2x2 factors and frozen historical control", () => {
    expect(R2_GROUPS.map(x => [x.defenseCost, x.defenseGain, x.defenseReductionMultipliers.length > 1]))
      .toEqual([[0, 0, false], [1, 0, false], [0, 0, true], [1, 0, true]]);
    expect(R1_CONTROL.defenseGain).toBe(1);
    expect(Object.isFrozen(C.defenseReductionMultipliers)).toBe(true);
  });
  it.each([A, B, C, D])("$id spends configured cost, gives no energy, keeps source unchanged", config => {
    const s = state("boss", 1), copy = structuredClone(s), base = structuredClone(GAME_CONFIG);
    const step = performR2Action(s, "defend", config);
    expect(step.state.battle.player.energy).toBe(2 - config.defenseCost);
    expect(step.defense?.energyGained).toBe(0);
    expect(step.defense?.energySpent).toBe(config.defenseCost);
    expect(s).toEqual(copy); expect(GAME_CONFIG).toEqual(base);
  });
  it("applies all five decay multipliers to base plus Armor without rounding", () => {
    let s = state("boss", 1); const factors = [], reductions = [];
    for (let i = 0; i < 6; i++) {
      const step = performR2Action(s, "defend", C); factors.push(step.defense?.multiplier);
      reductions.push(step.defense?.reductionAvailable); s = step.state;
    }
    expect(factors).toEqual([1, 0.75, 0.5, 0.25, 0, 0]);
    expect(reductions).toEqual([18, 13.5, 9, 4.5, 0, 0]);
  });
  it("uses fractional HP loss for a decayed special attack", () => {
    const s = state("boss", 1, 2, 1);
    const step = performR2Action({ ...s, battle: { ...s.battle, enemyAttacksExecuted: 2 } }, "defend", C);
    expect(step.state.battle.player.hp).toBe(191.5);
    expect(step.defense?.damagePrevented).toBe(13.5);
  });
  it.each(["attack", "heavy", "charge"] as ActionId[])("accepted %s resets streak and exactly delegates to R1 engine", action => {
    const s = state("boss", 2, 2, 4);
    const step = performR2Action(s, action, D);
    expect(step.result).toEqual(performAction(s.battle, action));
    expect(step.state.consecutiveDefenses).toBe(0); expect(step.defense).toBeNull();
  });
  it("insufficient defense energy rejects without any transition", () => {
    const s = state("boss", 2, 0, 3), step = performR2Action(s, "defend", D);
    expect(step.result).toMatchObject({ accepted: false, reason: "insufficient-energy" });
    expect(step.state).toBe(s);
  });
  it("rejected heavy, unknown action and terminal actions preserve streak", () => {
    const s = state("boss", 2, 0, 3);
    expect(performR2Action(s, "heavy", C).state).toBe(s);
    expect(performR2Action(s, "invalid" as ActionId, C).state).toBe(s);
    const terminal = { ...s, battle: { ...s.battle, phase: "defeat" as const } };
    expect(performR2Action(terminal, "charge", D).state).toBe(terminal);
  });
  it.each([0, 1, 2])("Armor level %i still improves dangerous defense at first use", armor => {
    const s = state("boss", armor), step = performR2Action({ ...s, battle: { ...s.battle, enemyAttacksExecuted: 2 } }, "defend", A);
    expect(step.state.battle.player.hp).toBe(200 - Math.max(0, 22 - 12 - armor * 6));
  });
  it("historical control matches real engine on a sequence including reset and special attacks", () => {
    let s = state("boss", 1);
    for (const action of ["defend", "defend", "heavy", "charge", "defend"] as const) {
      const expected = performAction(s.battle, action), step = performR2Action(s, action, R1_CONTROL);
      expect(step.result).toEqual(expected); s = step.state;
    }
  });
  it("kill on special preview does not execute a counterattack", () => {
    const s = state(), battle = { ...s.battle, enemy: { id: "boss" as const, hp: 1 }, enemyAttacksExecuted: 2 };
    const step = performR2Action({ ...s, battle }, "heavy", D);
    expect(step.state.battle.phase).toBe("victory");
    expect(step.state.battle.enemyAttacksExecuted).toBe(2);
  });
  it("charge can make paid defense affordable", () => {
    const s = performR2Action(state("boss", 2, 0), "charge", D).state;
    expect(performR2Action(s, "defend", D).state.battle.player.energy).toBe(1);
  });
  it("rejects invalid config and streak before transition", () => {
    for (const value of [-1, NaN, Infinity]) expect(() => validateMechanism({ ...C, defenseCost: value })).toThrow(TypeError);
    expect(() => validateMechanism({ ...C, defenseReductionMultipliers: Array(2) })).toThrow(TypeError);
    expect(() => performR2Action({ ...state(), consecutiveDefenses: -1 }, "defend", C)).toThrow(TypeError);
  });
});
describe("R2 compatibility strategy and challenge framework", () => {
  it("keeps original intent and independent strategy ID; paid defense falls back to charge", () => {
    const decision = chooseR2Action(state("boss", 2, 0), "E", B);
    expect(decision).toEqual({ strategyVersion: "R2-compat-E-v1", originalIntent: "defend", action: "charge", fallbackReason: "defense-insufficient-energy" });
    expect(chooseR2Action(state("boss", 2, 1), "E", B).action).toBe("defend");
  });
  it("historical D lethal threshold is explicitly preserved, not silently optimized for decay", () => {
    const s = state("boss", 2, 2, 4), low = { ...s, battle: { ...s.battle, player: { ...s.battle.player, hp: 7 } } };
    expect(chooseR2Action(low, "D", C).action).toBe("defend");
    expect(performR2Action(low, "defend", C).state.battle.phase).toBe("defeat");
  });
  it("defines 54 fixed scenarios without executing the matrix", () => {
    expect(R2_SCENARIOS).toHaveLength(54);
    expect(new Set(R2_SCENARIOS.map(s => `${s.upgradePath.join("-")}__${s.strategyId}`)).size).toBe(54);
    expect(R2_SCENARIOS[0]).toEqual({ strategyId: "A", upgradePath: ["blade", "blade"] });
    expect(R2_SCENARIOS.at(-1)).toEqual({ strategyId: "F", upgradePath: ["armor", "armor"] });
  });
  it("independently initializes each run and preserves inputs", () => {
    const a = runR2Challenge(scenario, C, 1), b = runR2Challenge(scenario, C, 1);
    expect(a).toEqual(b); expect(a.battles[0].initial.battle).toEqual(startBattle("light", createInitialProgress()));
    expect(a.battles[0].initial).not.toBe(b.battles[0].initial);
    expect(scenario.upgradePath).toEqual(["armor", "armor"]);
    expect(serializeR2Run(a)).toBe(serializeR2Run(b));
  });
  it("matches a representative R1 control including HP inheritance, energy and streak resets", () => {
    const run = runR2Challenge(scenario, R1_CONTROL), old = runChallengeDiagnostics(scenario);
    expect(run.outcome).toBe("victory"); expect(run.summary.playerActions).toBe(old.summary.playerActions);
    expect(run.summary.finalHp).toBe(old.summary.playerHp);
    expect(run.battles).toHaveLength(3); expect(run.upgrades).toHaveLength(2);
    for (let i = 1; i < 3; i++) {
      expect(run.battles[i].initial.battle.player.hp).toBe(run.battles[i - 1].final.battle.player.hp);
      expect(run.battles[i].initial.battle.player.energy).toBe(2);
      expect(run.battles[i].initial.consecutiveDefenses).toBe(0);
    }
    expect(run.battles[2].initial.battle.player.upgrades.armor).toBe(2);
    verifyR2Run(run);
  });
  it("retains victory on final allowed action and times out only if ongoing", () => {
    const s = { strategyId: "A" as const, upgradePath: ["core", "core"] as const };
    const terminal = runR2Challenge(s, A, 4);
    expect(terminal.battles[0].outcome).toBe("victory");
    expect(terminal.battles[1].outcome).toBe("timeout"); verifyR2Run(terminal);
    const timeout = runR2Challenge(s, A, 3); expect(timeout.battles).toHaveLength(1); verifyR2Run(timeout);
  });
  it("retains defeat on final allowed action", () => {
    const plan = { strategyId: "E" as const, upgradePath: ["blade", "blade"] as const };
    const run = runR2Challenge(plan, R1_CONTROL);
    const n = run.battles.at(-1)!.actions.length;
    const limited = runR2Challenge(plan, R1_CONTROL, n);
    expect(limited.outcome).toBe("defeat"); verifyR2Run(limited);
  });
  it("records rejection and stops as error", () => {
    vi.spyOn(mechanics, "performR2Action").mockImplementation(s => ({ state: s, result: { accepted: false, state: s.battle, reason: "insufficient-energy" }, defense: null }));
    const run = runR2Challenge(scenario, A);
    expect(run.outcome).toBe("error"); expect(run.summary.actionAttempts).toBe(1); expect(run.summary.playerActions).toBe(0);
    expect(run.battles[0].actions[0].error).toBe("insufficient-energy"); expect(() => serializeR2Run(run)).toThrow();
  });
  it("records exception input and error instead of losing attempted action", () => {
    vi.spyOn(mechanics, "performR2Action").mockImplementation(() => { throw new Error("injected fault"); });
    const run = runR2Challenge(scenario, C);
    expect(run.summary.actionAttempts).toBe(1); expect(run.battles[0].actions[0].effects).toBeNull();
    expect(run.error).toBe("injected fault"); expect(() => verifyR2Run(run)).not.toThrow();
  });
  it("invalid scenarios and limits never initialize combat", () => {
    const spy = vi.spyOn(mechanics, "performR2Action");
    for (const path of [[], ["armor"], ["armor", "armor", "armor"], Array(2), ["bad", "core"]]) {
      expect(() => runR2Challenge({ ...scenario, upgradePath: path } as never, A)).toThrow(TypeError);
    }
    expect(() => runR2Challenge({ ...scenario, strategyId: "toString" } as never, A)).toThrow();
    expect(() => runR2Challenge(scenario, A, 0)).toThrow(); expect(spy).not.toHaveBeenCalled();
  });
});
describe("trace-derived statistics and independent replay", () => {
  it("recalculates damage, energy, action types and streak distribution from transitions", () => {
    const run = runR2Challenge(scenario, R1_CONTROL); verifyR2Run(run);
    const all = run.battles.flatMap(b => b.actions), defs = all.filter(a => a.accepted && a.decision.action === "defend");
    expect(run.summary.defenseUses).toBe(14); expect(run.summary.defenseEnergyGained).toBe(14);
    expect(run.summary.defenseEnergySpent).toBe(0); expect(run.summary.maxDefenseStreak).toBe(2);
    expect(run.summary.defenseStreakDistribution).toEqual({ 2: 7 });
    expect(run.summary.effectiveHpLoss).toBe(83); expect(run.summary.bossSpecialAttacks).toBe(4);
    expect(run.summary.defenseReduction).toBe(defs.reduce((n, a) => n + a.defense!.damagePrevented, 0));
    expect(run.summary.playerActions).toBe(all.length);
  });
  it.each([A, B, C, D])("$id representative limit sample replays without changing inputs", config => {
    const run = runR2Challenge(scenario, config, 6), copy = structuredClone(run);
    verifyR2Run(run); const text = serializeR2Run(run); expect(JSON.parse(text).result).toEqual(run); expect(run).toEqual(copy);
  });
  it.each(["summary", "strategy", "intent", "streak", "energy", "effects", "upgrade", "extra-upgrade", "enemy", "early-stop", "timeout", "limit", "extra-action"])("rejects %s tampering", kind => {
    const r = structuredClone(runR2Challenge(scenario, R1_CONTROL));
    const a = r.battles[0].actions[0];
    switch (kind) {
      case "summary": Object.assign(r.summary, { rawHpLoss: 0, defenseReduction: 0 }); break;
      case "strategy": Object.assign(r.scenario, { strategyId: "A" }); break;
      case "intent": Object.assign(a, { intentBefore: null }); break;
      case "streak": Object.assign(a.after, { consecutiveDefenses: 2 }); break;
      case "energy": Object.assign(r.battles[1].initial.battle.player, { energy: 3 }); Object.assign(r.battles[1].actions[0].before.battle.player, { energy: 3 }); break;
      case "effects": Object.assign(a.effects!, { effects: {} }); break;
      case "upgrade": (r.upgrades as unknown[]).splice(0, 1); break;
      case "extra-upgrade": (r.upgrades as unknown[]).push(r.upgrades[0]); break;
      case "enemy": Object.assign(r.battles[1].initial.battle.enemy, { id: "boss" }); break;
      case "early-stop": (r.battles as unknown[]).splice(1); break;
      case "timeout": Object.assign(r, { outcome: "timeout" }); break;
      case "limit": Object.assign(r, { maxActionsPerBattle: 1 }); break;
      case "extra-action": (r.battles[0].actions as unknown[]).push(a); break;
    }
    expect(() => verifyR2Run(r)).toThrow();
  });
  it.each([NaN, Infinity, undefined, Symbol("bad"), BigInt(1)])("rejects non-JSON content %s", value => {
    expect(() => assertR2Json({ value })).toThrow(TypeError);
  });
  it("rejects cycles and sparse arrays", () => {
    const cycle: unknown[] = []; cycle.push(cycle);
    expect(() => assertR2Json(cycle)).toThrow(); expect(() => assertR2Json(Array(1))).toThrow();
  });
});
