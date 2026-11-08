import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { GAME_CONFIG } from "../data/game-config";
import * as engine from "../lib/game/engine";
import * as controller from "../lib/challenge/controller";
import { CHALLENGE_SCENARIOS, UPGRADE_PATHS, runChallengeDiagnostics, type ChallengeScenario } from "../lib/simulation/run-challenge-diagnostics-r1";
import { STRATEGIES } from "../lib/simulation/strategies";
import type { ActionId } from "../lib/game/types";

const scenario = Object.freeze({ strategyId: "E" as const, upgradePath: Object.freeze(["armor", "armor"] as const) });
describe("R1 challenge diagnostics (representative runs only, no full matrix execution)", () => {
  it("defines nine ordered paths and 54 unique scenarios without running them", () => {
    expect(UPGRADE_PATHS).toEqual([
      ["blade", "blade"], ["blade", "core"], ["blade", "armor"],
      ["core", "blade"], ["core", "core"], ["core", "armor"],
      ["armor", "blade"], ["armor", "core"], ["armor", "armor"],
    ]);
    expect(CHALLENGE_SCENARIOS).toHaveLength(54);
    expect(new Set(CHALLENGE_SCENARIOS.map(s => `${s.upgradePath.join("/")}/${s.strategyId}`)).size).toBe(54);
    for (const path of UPGRADE_PATHS) expect(CHALLENGE_SCENARIOS.filter(s => s.upgradePath === path).map(s => s.strategyId)).toEqual(["A", "B", "C", "D", "E", "F"]);
  });
  it("replays a complete challenge through the real engine and reconciles statistics", () => {
    const run = runChallengeDiagnostics(scenario);
    expect(run.summary.outcome).toBe("victory");
    expect(run.summary.completedBattles).toBe(3); expect(run.upgrades).toHaveLength(2);
    let progress = engine.createInitialProgress();
    let taken = 0, dealt = 0, rawTaken = 0, rawDealt = 0, actions = 0, attacks = 0, normal = 0, special = 0;
    const counts = { attack: 0, heavy: 0, defend: 0, charge: 0 };
    for (const [index, battle] of run.battles.entries()) {
      let cursor = engine.startBattle(controller.ENCOUNTERS[index], progress);
      expect(battle.initialState).toEqual(cursor);
      expect(cursor.player.energy).toBe(2); expect(cursor.turn).toBe(1); expect(cursor.enemyAttacksExecuted).toBe(0);
      for (const step of battle.actions) {
        expect(step.before).toEqual(cursor); expect(step.intentBefore).toEqual(engine.getEnemyIntent(cursor));
        expect(step.action).toBe(STRATEGIES.E(cursor, step.intentBefore));
        const next = engine.performAction(cursor, step.action!);
        expect(next.accepted).toBe(true); if (!next.accepted) throw new Error(next.reason);
        expect(step.after).toEqual(next.state); expect(step.effects).toEqual(next.effects);
        expect(step.accepted).toBe(true); expect(step.error).toBeNull();
        actions++; counts[step.action!]++;
        taken += Math.max(0, cursor.player.hp) - Math.max(0, next.state.player.hp);
        dealt += Math.max(0, cursor.enemy.hp) - Math.max(0, next.state.enemy.hp);
        rawTaken += cursor.player.hp - next.state.player.hp; rawDealt += cursor.enemy.hp - next.state.enemy.hp;
        attacks += next.state.enemyAttacksExecuted - cursor.enemyAttacksExecuted;
        if (cursor.enemy.id === "boss" && next.effects.enemyIntent) {
          if (next.effects.enemyIntent.kind === "special") special++; else normal++;
        }
        cursor = next.state;
      }
      expect(battle.finalState).toEqual(cursor);
      const last = battle.actions.at(-1)!;
      expect(last.effects!.enemyIntent).toBeNull(); expect(last.after.enemyAttacksExecuted).toBe(last.before.enemyAttacksExecuted);
      progress = engine.getPlayerProgress(cursor);
      if (index < 2) {
        const transition = run.upgrades[index]; expect(transition.before).toEqual(cursor);
        progress = engine.applyUpgrade(progress, "armor");
        expect(transition.after.player.hp).toBe(cursor.player.hp);
        expect(transition.after.player.upgrades.armor).toBe(index + 1);
      }
    }
    expect(run.summary).toMatchObject({ playerActions: actions, actionAttempts: actions, enemyAttacks: attacks,
      totalDamageTaken: taken, totalDamageDealt: dealt, rawHpLossTaken: rawTaken, rawHpLossDealt: rawDealt,
      overkillDamageTaken: rawTaken - taken, overkillDamageDealt: rawDealt - dealt,
      bossNormalAttacks: normal, bossSpecialAttacks: special,
      attackCount: counts.attack, heavyCount: counts.heavy, defendCount: counts.defend, chargeCount: counts.charge });
  });
  it("independently initializes runs and preserves frozen inputs and configuration", () => {
    const config = structuredClone(GAME_CONFIG), options = Object.freeze({ maxActions: 1 });
    const a = runChallengeDiagnostics(scenario, options), b = runChallengeDiagnostics(scenario, options);
    expect(a).toEqual(b); expect(a.battles[0].initialState).not.toBe(b.battles[0].initialState);
    expect(a.battles[0].initialState.player.upgrades).not.toBe(b.battles[0].initialState.player.upgrades);
    expect(a.battles[0].initialState.player).toEqual({ hp: 100, energy: 2, energyCap: 4, upgrades: { blade: 0, core: 0, armor: 0 } });
    expect(scenario.upgradePath).toEqual(["armor", "armor"]); expect(options).toEqual({ maxActions: 1 }); expect(GAME_CONFIG).toEqual(config);
    const bad = runChallengeDiagnostics(scenario, { chooseAction: state => { Object.assign(state.player, { hp: 1 }); return "attack"; } });
    expect(bad.summary).toMatchObject({ outcome: "error", playerHp: 100, playerActions: 0, actionAttempts: 1 });
  });
  it("resets energy while preserving cumulative Core capacity", () => {
    const run = runChallengeDiagnostics({ strategyId: "E", upgradePath: ["core", "core"] });
    expect(run.battles.map(b => b.initialState.player.energyCap)).toEqual([4, 5, 6]);
    expect(run.battles.map(b => b.initialState.player.energy)).toEqual([2, 2, 2]);
    expect(run.upgrades.map(u => u.after.player.upgrades.core)).toEqual([1, 2]);
  });
  it("preserves victory on action 200 of a battle and then starts the next battle", () => {
    let calls = 0;
    const run = runChallengeDiagnostics(scenario, { chooseAction: () => ++calls <= 196 ? "defend" : calls <= 200 ? "attack" : (() => { throw new Error("stop next battle"); })() });
    expect(run.battles[0].summary).toMatchObject({ outcome: "victory", playerActions: 200 });
    expect(run.summary).toMatchObject({ completedBattles: 1, startedBattles: 2, outcome: "error" });
  });
  it("preserves defeat on action 200 without classifying it as timeout", () => {
    let calls = 0;
    const run = runChallengeDiagnostics(scenario, { chooseAction: () => ++calls <= 188 ? "defend" : "charge" });
    expect(run.summary).toMatchObject({ outcome: "defeat", playerActions: 200, completedBattles: 0, startedBattles: 1 });
  });
  it("times out only when action 200 leaves the battle ongoing", () => {
    const run = runChallengeDiagnostics(scenario, { chooseAction: () => "defend" });
    expect(run.summary).toMatchObject({ outcome: "timeout", playerActions: 200, actionAttempts: 200, startedBattles: 1 });
    expect(run.battles[0].finalState.phase).toBe("ongoing"); expect(run.upgrades).toHaveLength(0);
  });
  it("stops immediately on rejection or strategy exceptions without replacement", () => {
    const rejected = runChallengeDiagnostics(scenario, { chooseAction: () => "heavy" });
    expect(rejected.summary).toMatchObject({ outcome: "error", playerActions: 1, actionAttempts: 2, startedBattles: 1 });
    expect(rejected.summary.reason).toContain("insufficient-energy");
    expect(rejected.battles[0].actions[1].accepted).toBe(false);
    const unknown = runChallengeDiagnostics(scenario, { chooseAction: () => "bad" as ActionId });
    expect(unknown.summary.reason).toContain("unknown-action");
    const thrown = runChallengeDiagnostics(scenario, { chooseAction: () => { throw new Error("policy failed"); } });
    expect(thrown.summary).toMatchObject({ outcome: "error", playerActions: 0, actionAttempts: 1, reason: "policy failed" });
  });
  it("retains malformed accepted output as error evidence without corrupting validated totals", () => {
    const original = controller.act;
    const spy = vi.spyOn(controller, "act").mockImplementation((s, a) => {
      const next = original(s, a);
      if (!next.result?.accepted) return next;
      return { ...next, result: { ...next.result, state: { ...next.result.state, player: { ...next.result.state.player, hp: NaN } } } };
    });
    try {
      const run = runChallengeDiagnostics(scenario);
      expect(run.summary).toMatchObject({ outcome: "error", playerActions: 1, actionAttempts: 1, playerHp: 100 });
      expect(run.battles[0].actions[0].accepted).toBe(true);
      expect(run.battles[0].actions[0].after.player.hp).toBeNaN();
      expect(run.battles[0].actions[0].error).toContain("Invalid engine output");
    } finally { spy.mockRestore(); }
  });
  it("stops on controller exceptions and rejected upgrade transitions", () => {
    const action = vi.spyOn(controller, "act").mockImplementation(() => { throw new Error("controller failed"); });
    try {
      expect(runChallengeDiagnostics(scenario).summary).toMatchObject({ outcome: "error", actionAttempts: 1, playerActions: 0, reason: "controller failed" });
    } finally { action.mockRestore(); }
    const upgrade = vi.spyOn(controller, "selectUpgrade").mockImplementation(state => state);
    try {
      const run = runChallengeDiagnostics(scenario);
      expect(run.summary).toMatchObject({ outcome: "error", startedBattles: 1, completedBattles: 1, reason: "Upgrade transition rejected" });
      expect(run.upgrades).toHaveLength(0);
    } finally { upgrade.mockRestore(); }
  });
  it.each([
    { label: "three upgrades", input: { strategyId: "E", upgradePath: ["blade", "core", "armor"] } },
    { label: "one upgrade", input: { strategyId: "E", upgradePath: ["blade"] } },
    { label: "empty path", input: { strategyId: "E", upgradePath: [] } },
    { label: "non-array path", input: { strategyId: "E", upgradePath: "blade" } },
    { label: "invalid upgrade", input: { strategyId: "E", upgradePath: ["blade", "unknown"] } },
    { label: "invalid strategy", input: { strategyId: "G", upgradePath: ["blade", "core"] } },
    { label: "inherited strategy name", input: { strategyId: "toString", upgradePath: ["blade", "core"] } },
    { label: "sparse path", input: { strategyId: "E", upgradePath: new Array(2) } },
    { label: "missing second slot", input: { strategyId: "E", upgradePath: ["blade", ,] } },
    { label: "null scenario", input: null },
    { label: "undefined scenario", input: undefined },
    { label: "primitive scenario", input: "E" },
    { label: "array scenario", input: [] },
    { label: "missing path", input: { strategyId: "E" } },
    { label: "missing strategy", input: { upgradePath: ["blade", "core"] } },
  ])("rejects $label before initializing any challenge", ({ input }) => {
    const initialize = vi.spyOn(controller, "createChallenge");
    const start = vi.spyOn(engine, "startBattle");
    try {
      expect(() => runChallengeDiagnostics(input as unknown as ChallengeScenario)).toThrow(TypeError);
      expect(() => runChallengeDiagnostics(input as unknown as ChallengeScenario)).toThrow(/Invalid/);
      expect(initialize).not.toHaveBeenCalled(); expect(start).not.toHaveBeenCalled();
    } finally { initialize.mockRestore(); start.mockRestore(); }
  });
  it("copies valid inputs before freezing without freezing the caller's path", () => {
    const input: ChallengeScenario = { strategyId: "E", upgradePath: ["blade", "core"] };
    const run = runChallengeDiagnostics(input, { maxActions: 1 });
    expect(run.scenario).toEqual(input); expect(run.scenario).not.toBe(input);
    expect(run.scenario.upgradePath).not.toBe(input.upgradePath);
    expect(Object.isFrozen(run.scenario.upgradePath)).toBe(true);
    expect(Object.isFrozen(input)).toBe(false); expect(Object.isFrozen(input.upgradePath)).toBe(false);
  });
  it("rejects invalid test limits before execution", () => {
    for (const maxActions of [0, 201, 1.5, NaN]) expect(() => runChallengeDiagnostics(scenario, { maxActions })).toThrow(RangeError);
  });
  it("keeps protected source, historical data and reports byte-identical to the approved baseline", () => {
    const paths = execFileSync("git", ["ls-tree", "-r", "--name-only", "e3f0a3ff04506e6cbb7f2736f50ca710d7687cc7"], { encoding: "utf8" }).trim().split("\n")
      .filter(p => p.startsWith("lib/") || p.startsWith("data/") || p.startsWith("docs/") || p.startsWith("components/") || p.startsWith("tests/"));
    for (const p of paths) expect(readFileSync(p)).toEqual(execFileSync("git", ["show", `e3f0a3ff04506e6cbb7f2736f50ca710d7687cc7:${p}`]));
  });
});
