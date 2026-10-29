import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { GAME_CONFIG } from "../data/game-config";
import { createInitialProgress, getEnemyIntent, performAction, startBattle } from "../lib/game/engine";
import type { BattleState } from "../lib/game/types";
import { runComparison, COMPARISON_SCENARIOS } from "../lib/simulation/run-comparison";
import { runSimulation } from "../lib/simulation/run-simulation";
import { STRATEGIES } from "../lib/simulation/strategies";
import type { SimulationResult } from "../lib/simulation/types";

function input(energy: number, enemyHp = 120, blades = 0): BattleState {
  const state = startBattle("boss", createInitialProgress());
  return { ...state, enemy: { ...state.enemy, hp: enemyHp }, player: {
    ...state.player, energy, upgrades: { ...state.player.upgrades, blade: blades },
  } };
}
function freeze<T>(value: T): T {
  if (value !== null && typeof value === "object") {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
}

describe("predefined E/F decisions", () => {
  it.each([0, 1])("E defends at energy %i with an announced attack", energy => {
    const state = input(energy);
    expect(STRATEGIES.E(state, getEnemyIntent(state))).toBe("defend");
  });
  it.each([2, 3, 4])("E follows B at energy %i", energy => {
    const state = input(energy);
    expect(STRATEGIES.E(state, getEnemyIntent(state))).toBe(STRATEGIES.B(state, getEnemyIntent(state)));
    expect(STRATEGIES.E(state, getEnemyIntent(state))).toBe("heavy");
  });
  it("E falls back to B without an executable intent, and does not adopt D's threat threshold", () => {
    expect(STRATEGIES.E(input(0), null)).toBe("attack");
    const base = input(0);
    const doomed = { ...base, player: { ...base.player, hp: 1 }, enemyAttacksExecuted: 2 };
    expect(STRATEGIES.E(doomed, getEnemyIntent(doomed))).toBe("defend");
    expect(STRATEGIES.D(doomed, getEnemyIntent(doomed))).toBe("attack");
  });
  it.each([1, 11, 12])("F prioritizes a lethal basic attack at enemy HP %i even with heavy affordable", hp => {
    const state = input(2, hp);
    expect(STRATEGIES.F(state, getEnemyIntent(state))).toBe("attack");
  });
  it.each([13, 25])("F uses affordable lethal heavy at enemy HP %i", hp => {
    const state = input(2, hp);
    expect(STRATEGIES.F(state, getEnemyIntent(state))).toBe("heavy");
  });
  it.each([0, 1, 2, 4])("F falls back to B when no affordable finisher exists, energy %i", energy => {
    const state = input(energy, 100);
    expect(STRATEGIES.F(state, getEnemyIntent(state))).toBe(STRATEGIES.B(state, getEnemyIntent(state)));
  });
  it("F never spends unavailable energy on a heavy finisher", () => {
    expect(STRATEGIES.F(input(1, 25), null)).toBe("attack");
  });
  it("F uses the accepted cumulative blade formula, with lethal checks verified by the engine", () => {
    const basic = input(2, 18, 2);
    expect(STRATEGIES.F(basic, getEnemyIntent(basic))).toBe("attack");
    const basicResult = performAction(basic, STRATEGIES.F(basic, getEnemyIntent(basic)));
    expect(basicResult.accepted).toBe(true);
    expect(basicResult.state.phase).toBe("victory");
    const heavy = input(2, 31, 2);
    expect(STRATEGIES.F(heavy, getEnemyIntent(heavy))).toBe("heavy");
    expect(performAction(heavy, STRATEGIES.F(heavy, getEnemyIntent(heavy))).state.phase).toBe("victory");
    expect(STRATEGIES.F(input(2, 32, 2), null)).toBe("heavy"); // B fallback, not a lethal prediction.
  });
  it.each(["E", "F"] as const)("%s is deterministic and preserves frozen state, intent and configuration", id => {
    const state = freeze(input(1, 12, 1));
    const intent = freeze(getEnemyIntent(state));
    const snapshot = structuredClone(state);
    const config = structuredClone(GAME_CONFIG);
    expect(STRATEGIES[id](state, intent)).toBe(STRATEGIES[id](state, intent));
    expect(state).toEqual(snapshot);
    expect(GAME_CONFIG).toEqual(config);
  });
});

describe("04B matrix and artifact integrity", () => {
  it.each(COMPARISON_SCENARIOS)("replays $enemyId/$strategyId through the real engine and reconciles all statistics", scenario => {
    const run = runSimulation(scenario);
    const s = run.summary;
    let cursor = startBattle(scenario.enemyId, createInitialProgress());
    const counts = { attack: 0, heavy: 0, defend: 0, charge: 0 };
    let attacks = 0, special = 0, normal = 0, taken = 0, dealt = 0, rawTaken = 0, rawDealt = 0;
    expect(run.initialState).toEqual(cursor);
    expect(cursor.player).toEqual({ hp: 100, energy: 2, energyCap: 4, upgrades: { blade: 0, core: 0, armor: 0 } });
    expect(cursor.enemyAttacksExecuted).toBe(0);
    for (const step of run.actions) {
      expect(step.before).toEqual(cursor);
      const intent = getEnemyIntent(cursor);
      expect(step.intentBefore).toEqual(intent);
      expect(step.action).toBe(STRATEGIES[scenario.strategyId](cursor, intent));
      expect(step.accepted).toBe(true);
      expect(step.error).toBeNull();
      const result = performAction(cursor, step.action!);
      if (!result.accepted) throw new Error(result.reason);
      expect(step.after).toEqual(result.state);
      expect(step.effects).toEqual(result.effects);
      counts[step.action!]++;
      attacks += result.state.enemyAttacksExecuted - cursor.enemyAttacksExecuted;
      taken += Math.max(0, cursor.player.hp) - Math.max(0, result.state.player.hp);
      dealt += Math.max(0, cursor.enemy.hp) - Math.max(0, result.state.enemy.hp);
      rawTaken += cursor.player.hp - result.state.player.hp;
      rawDealt += cursor.enemy.hp - result.state.enemy.hp;
      if (scenario.enemyId === "boss" && result.effects.enemyIntent !== null) {
        if (result.effects.enemyIntent.kind === "special") special++; else normal++;
      }
      cursor = result.state;
    }
    expect(run.finalState).toEqual(cursor);
    expect(s.outcome).toBe(cursor.phase);
    expect(s.playerActions).toBe(run.actions.length);
    expect(s.actionAttempts).toBe(run.actions.length);
    expect(s.playerActions).toBe(Object.values(counts).reduce((a, b) => a + b, 0));
    expect([s.attackCount, s.heavyCount, s.defendCount, s.chargeCount]).toEqual(Object.values(counts));
    expect(s.enemyAttacks).toBe(attacks);
    expect(s.enemyAttacks).toBe(cursor.enemyAttacksExecuted);
    expect([s.totalDamageTaken, s.totalDamageDealt, s.rawHpLossTaken, s.rawHpLossDealt]).toEqual([taken, dealt, rawTaken, rawDealt]);
    expect(s.totalDamageTaken).toBe(s.initialPlayerHp - Math.max(0, s.playerHp));
    expect(s.totalDamageDealt).toBe(s.initialEnemyHp - Math.max(0, s.enemyHp));
    expect([s.bossNormalAttacks, s.bossSpecialAttacks]).toEqual([normal, special]);
    expect(s.finalEnergy).toBe(cursor.player.energy);
    expect(s.reason).toBeNull();
  });
  it("has all 12 unique scenarios, independent objects and deterministic persisted results", () => {
    const first = runComparison(), second = runComparison();
    expect(first).toHaveLength(12);
    expect(new Set(first.map(r => `${r.summary.enemyId}/${r.summary.strategyId}`)).size).toBe(12);
    expect(second).toEqual(first);
    expect(JSON.stringify(second)).toBe(JSON.stringify(first));
    for (let i = 1; i < first.length; i++) {
      expect(first[i].initialState).not.toBe(first[0].initialState);
      expect(first[i].initialState.player.upgrades).not.toBe(first[0].initialState.player.upgrades);
    }
    const saved = JSON.parse(readFileSync("data/simulation/strategy-comparison-actions.json", "utf8")) as { simulations: SimulationResult[] };
    expect(saved.simulations).toEqual(first);
    const [header, ...lines] = readFileSync("data/simulation/strategy-comparison-results.csv", "utf8").trim().split("\n");
    expect(lines).toHaveLength(12);
    const columns = header.split(",") as (keyof SimulationResult["summary"])[];
    expect(columns).toHaveLength(24);
    lines.forEach((line, index) => {
      const values = line.split(",").map(cell => cell === "" ? "" : JSON.parse(cell));
      columns.forEach((column, i) => expect(values[i]).toBe(first[index].summary[column] == null ? "" : String(first[index].summary[column])));
    });
  });
  it("keeps 04A files byte-identical and B/D trajectories identical to the original baseline", () => {
    const hashes = {
      "data/simulation/baseline-results.csv": "c2caf08f5e5f74679da37ad6ca9512e3c014585286fc9cfb78881c31f91e6abd",
      "data/simulation/baseline-actions.json": "8f67089be2579ea57e964c4cb2c05175b1ef97081524517343cbc248b75d8e42",
      "docs/BALANCE_BASELINE.md": "f73c7934a01228ec557c43b4790baa7412376ff622f7e2ab2a914b04ed6be52b",
    };
    for (const [file, hash] of Object.entries(hashes)) expect(createHash("sha256").update(readFileSync(file)).digest("hex")).toBe(hash);
    const baseline = JSON.parse(readFileSync("data/simulation/baseline-actions.json", "utf8")) as { simulations: SimulationResult[] };
    for (const run of runComparison().filter(r => r.summary.strategyId === "B" || r.summary.strategyId === "D")) {
      expect(run).toEqual(baseline.simulations.find(r => r.summary.enemyId === run.summary.enemyId && r.summary.strategyId === run.summary.strategyId));
    }
  });
  it.each(["E", "F"] as const)("%s retains timeout, error, rejection and immutable-input handling", strategyId => {
    const scenario = Object.freeze({ enemyId: "light", strategyId } as const);
    expect(runSimulation(scenario, { maxActions: 1 }).summary.outcome).toBe("timeout");
    expect(runSimulation(scenario, { chooseAction: () => "defend" }).summary).toMatchObject({ outcome: "timeout", playerActions: 200 });
    const rejected = runSimulation({ enemyId: "boss", strategyId }, { chooseAction: () => "heavy" });
    expect(rejected.summary).toMatchObject({ outcome: "error", playerActions: 1, actionAttempts: 2 });
    expect(rejected.summary.reason).toContain("insufficient-energy");
    const exception = runSimulation(scenario, { chooseAction: () => { throw new Error("04B policy exception"); } });
    expect(exception.summary).toMatchObject({ outcome: "error", reason: "04B policy exception", playerActions: 0 });
    const mutation = runSimulation(scenario, { chooseAction: state => { Object.assign(state.player, { hp: 0 }); return "attack"; } });
    expect(mutation.summary.outcome).toBe("error");
    expect(mutation.finalState.player.hp).toBe(100);
    expect(scenario).toEqual({ enemyId: "light", strategyId });
  });
});
