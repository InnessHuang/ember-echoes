import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { GAME_CONFIG } from "../data/game-config";
import * as engine from "../lib/game/engine";
import type { ActionId, BattleState } from "../lib/game/types";
import { BASELINE_SCENARIOS, MAX_ACTIONS, runBaseline, runSimulation } from "../lib/simulation/run-simulation";
import { STRATEGIES } from "../lib/simulation/strategies";
import type { SimulationResult } from "../lib/simulation/types";

function state(hp: number, count = 0): BattleState {
  const base = engine.startBattle("boss", engine.createInitialProgress());
  return { ...base, player: { ...base.player, hp }, enemyAttacksExecuted: count };
}
function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object") {
    Object.values(value).forEach(deepFreeze);
    Object.freeze(value);
  }
  return value;
}

describe("fixed policies", () => {
  it.each(["A", "B", "C", "D"] as const)("%s is deterministic and preserves frozen inputs", id => {
    const input = deepFreeze(state(8));
    const intent = deepFreeze(engine.getEnemyIntent(input));
    const before = structuredClone(input);
    expect(STRATEGIES[id](input, intent)).toBe(STRATEGIES[id](input, intent));
    expect(input).toEqual(before);
  });
  it("A always attacks, B uses affordable heavy and otherwise attacks", () => {
    const initial = state(100);
    expect(STRATEGIES.A(initial, null)).toBe("attack");
    expect(STRATEGIES.B(initial, null)).toBe("heavy");
    expect(STRATEGIES.B({ ...initial, player: { ...initial.player, energy: 1 } }, null)).toBe("attack");
  });
  it("C follows actual capacity, including upgraded capacity", () => {
    const initial = state(100);
    expect(STRATEGIES.C(initial, null)).toBe("charge");
    const upgraded = { ...initial, player: { ...initial.player, energy: 4, energyCap: 5, upgrades: { blade: 0, core: 1, armor: 0 } } };
    expect(STRATEGIES.C(upgraded, null)).toBe("charge");
    expect(STRATEGIES.C({ ...upgraded, player: { ...upgraded.player, energy: 5 } }, null)).toBe("heavy");
  });
  it.each([
    [13, 0, "heavy"], [12, 0, "defend"], [1, 0, "defend"],
    [23, 2, "heavy"], [22, 2, "defend"], [11, 2, "defend"], [10, 2, "heavy"], [1, 2, "heavy"],
  ] as const)("D at HP %i / executed %i chooses %s", (hp, count, action) => {
    const input = state(hp, count);
    expect(STRATEGIES.D(input, engine.getEnemyIntent(input))).toBe(action);
  });
  it("D uses effective armor reduction and obeys fallback energy checks", () => {
    const base = state(5, 2);
    const armored = { ...base, player: { ...base.player, upgrades: { blade: 0, core: 0, armor: 1 } } };
    expect(STRATEGIES.D(armored, engine.getEnemyIntent(armored))).toBe("defend");
    const doomed = { ...base, player: { ...base.player, energy: 0 } };
    expect(STRATEGIES.D(doomed, engine.getEnemyIntent(doomed))).toBe("attack");
  });
});

describe("simulation runner", () => {
  it.each(BASELINE_SCENARIOS)("replays $enemyId/$strategyId exactly through the engine and reconciles all metrics", scenario => {
    const run = runSimulation(scenario);
    const { summary: s } = run;
    let cursor = engine.startBattle(scenario.enemyId, engine.createInitialProgress());
    let taken = 0, dealt = 0, normal = 0, special = 0;
    const counts = { attack: 0, heavy: 0, defend: 0, charge: 0 };
    for (const step of run.actions) {
      expect(step.before).toEqual(cursor);
      expect(step.intentBefore).toEqual(engine.getEnemyIntent(cursor));
      expect(step.action).toBe(STRATEGIES[scenario.strategyId](cursor, step.intentBefore));
      const result = engine.performAction(cursor, step.action!);
      expect(result.accepted).toBe(true);
      if (!result.accepted) throw new Error(result.reason);
      expect(step.after).toEqual(result.state);
      expect(step.effects).toEqual(result.effects);
      counts[step.action!]++;
      taken += Math.max(0, cursor.player.hp) - Math.max(0, result.state.player.hp);
      dealt += Math.max(0, cursor.enemy.hp) - Math.max(0, result.state.enemy.hp);
      if (scenario.enemyId === "boss" && result.effects.enemyIntent !== null) {
        if (result.effects.enemyIntent.kind === "special") special++; else normal++;
      }
      cursor = result.state;
    }
    expect(run.finalState).toEqual(cursor);
    expect(s.outcome).toBe(cursor.phase);
    expect(s.playerActions).toBe(run.actions.length);
    expect(s.playerActions).toBe(Object.values(counts).reduce((a, b) => a + b, 0));
    expect([s.attackCount, s.heavyCount, s.defendCount, s.chargeCount]).toEqual(Object.values(counts));
    expect(s.totalDamageTaken).toBe(taken);
    expect(s.totalDamageDealt).toBe(dealt);
    expect(s.totalDamageTaken).toBe(s.initialPlayerHp - Math.max(0, s.playerHp));
    expect(s.totalDamageDealt).toBe(s.initialEnemyHp - Math.max(0, s.enemyHp));
    expect(s.rawHpLossTaken).toBe(s.initialPlayerHp - s.playerHp);
    expect(s.rawHpLossDealt).toBe(s.initialEnemyHp - s.enemyHp);
    expect(s.enemyAttacks).toBe(cursor.enemyAttacksExecuted);
    expect(s.bossNormalAttacks).toBe(normal);
    expect(s.bossSpecialAttacks).toBe(special);
    if (scenario.enemyId === "boss") expect(special).toBe(Math.floor(s.enemyAttacks / GAME_CONFIG.enemies.boss.specialEvery));
  });
  it("initializes independent 100 HP, 2/4 energy, zero upgrades for every experiment", () => {
    const runs = runBaseline();
    for (const run of runs) {
      expect(run.initialState.player).toEqual({ hp: 100, energy: 2, energyCap: 4, upgrades: { blade: 0, core: 0, armor: 0 } });
      expect(run.initialState.enemyAttacksExecuted).toBe(0);
    }
    expect(runs[0].initialState).not.toBe(runs[1].initialState);
    expect(runs[0].initialState.player.upgrades).not.toBe(runs[1].initialState.player.upgrades);
    expect(runBaseline()).toEqual(runs);
  });
  it("calls the accepted engine API for each actual action", () => {
    const spy = vi.spyOn(engine, "performAction");
    try {
      const run = runSimulation({ enemyId: "light", strategyId: "B" });
      expect(spy).toHaveBeenCalledTimes(3);
      expect(run.summary).toMatchObject({ outcome: "victory", playerHp: 82, playerActions: 3 });
    } finally { spy.mockRestore(); }
  });
  it("counts effective HP loss separately from overkill", () => {
    const s = runSimulation({ enemyId: "light", strategyId: "A" }).summary;
    expect(s).toMatchObject({ totalDamageDealt: 42, rawHpLossDealt: 48, enemyHp: -6 });
    const loss = runSimulation({ enemyId: "boss", strategyId: "A" }).summary;
    expect(loss).toMatchObject({ totalDamageTaken: 100, rawHpLossTaken: 104, playerHp: -4 });
  });
  it("stops at 200 accepted actions and keeps every timeout trace", () => {
    const run = runSimulation({ enemyId: "light", strategyId: "A" }, { chooseAction: () => "defend" });
    expect(run.summary).toMatchObject({ outcome: "timeout", playerActions: MAX_ACTIONS, enemyAttacks: 200, totalDamageTaken: 0 });
    expect(run.actions).toHaveLength(200);
    expect(run.finalState.phase).toBe("ongoing");
    expect(run.summary.reason).toContain("200");
  });
  it("recognizes victory on the final allowed action", () => {
    expect(runSimulation({ enemyId: "light", strategyId: "A" }, { maxActions: 4 }).summary.outcome).toBe("victory");
    expect(runSimulation({ enemyId: "light", strategyId: "A" }, { maxActions: 3 }).summary.outcome).toBe("timeout");
  });
  it.each([0, 201, 1.5, NaN])("rejects invalid maximum %s", maxActions => {
    expect(runSimulation({ enemyId: "light", strategyId: "A" }, { maxActions }).summary).toMatchObject({ outcome: "error", playerActions: 0 });
  });
  it("stops at the first rejected heavy without substituting actions", () => {
    const run = runSimulation({ enemyId: "boss", strategyId: "B" }, { chooseAction: () => "heavy" });
    expect(run.summary).toMatchObject({ outcome: "error", playerActions: 1, actionAttempts: 2, heavyCount: 1, enemyAttacks: 1 });
    expect(run.actions[1].after).toEqual(run.actions[1].before);
    expect(run.summary.reason).toContain("insufficient-energy");
  });
  it("stops unknown actions as errors", () => {
    const run = runSimulation({ enemyId: "light", strategyId: "A" }, { chooseAction: () => "invalid" as ActionId });
    expect(run.summary).toMatchObject({ outcome: "error", playerActions: 0, actionAttempts: 1 });
    expect(run.summary.reason).toContain("unknown-action");
  });
  it("records policy exceptions without claiming a win", () => {
    const run = runSimulation({ enemyId: "light", strategyId: "A" }, { chooseAction: () => { throw new Error("policy failed"); } });
    expect(run.summary).toMatchObject({ outcome: "error", playerActions: 0, reason: "policy failed" });
    expect(run.actions).toHaveLength(1);
  });
  it("stops invalid engine states without committing invalid metrics", () => {
    const base = state(100);
    const spy = vi.spyOn(engine, "performAction").mockReturnValue({ accepted: true,
      state: { ...base, player: { ...base.player, hp: NaN } },
      effects: { playerDamage: 0, damageTaken: 0, enemyIntent: null },
    });
    try {
      const run = runSimulation({ enemyId: "boss", strategyId: "A" });
      expect(run.summary).toMatchObject({ outcome: "error", playerActions: 0, totalDamageDealt: 0 });
      expect(run.summary.reason).toContain("Invalid engine output");
    } finally { spy.mockRestore(); }
  });
  it("does not modify configuration, frozen scenario or policy input", () => {
    const before = structuredClone(GAME_CONFIG);
    const scenario = Object.freeze({ enemyId: "light", strategyId: "A" } as const);
    const options = Object.freeze({ maxActions: 3 });
    runSimulation(scenario, options);
    expect(scenario).toEqual({ enemyId: "light", strategyId: "A" });
    expect(options).toEqual({ maxActions: 3 });
    expect(GAME_CONFIG).toEqual(before);
    const run = runSimulation(scenario, { chooseAction: input => { Object.assign(input.player, { hp: 1 }); return "attack"; } });
    expect(run.summary.outcome).toBe("error");
    expect(run.finalState.player.hp).toBe(100);
  });
  it("generates all 12 scenarios with complete fields and matching persisted artifacts", () => {
    const runs = runBaseline();
    expect(runs).toHaveLength(12);
    expect(new Set(runs.map(r => `${r.summary.enemyId}/${r.summary.strategyId}`)).size).toBe(12);
    for (const { summary } of runs) {
      expect(Object.keys(summary)).toHaveLength(24);
      expect(Object.values(summary)).not.toContain(undefined);
    }
    const artifact = JSON.parse(readFileSync("data/simulation/baseline-actions.json", "utf8")) as { config: unknown; simulations: SimulationResult[] };
    expect(artifact.config).toEqual(GAME_CONFIG);
    expect(artifact.simulations).toEqual(runs);
    const [header, ...lines] = readFileSync("data/simulation/baseline-results.csv", "utf8").trim().split("\n");
    expect(lines).toHaveLength(12);
    const columns = header.split(",") as (keyof SimulationResult["summary"])[];
    lines.forEach((line, index) => {
      const values = line.split(",").map(cell => cell === "" ? "" : JSON.parse(cell));
      columns.forEach((column, i) => expect(values[i]).toBe(runs[index].summary[column] == null ? "" : String(runs[index].summary[column])));
    });
  });
});
