import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { GAME_CONFIG } from "../data/game-config";
import { createInitialProgress, getEnemyIntent, performAction, startBattle } from "../lib/game/engine";
import { STRATEGIES } from "../lib/simulation/strategies";
import { BOSS_RESOURCE_SCENARIOS, RESOURCE_STRATEGY_MAPPING, bossResourceCsv, createBossResourceExperiment, runBossResourceComparison } from "../lib/simulation/run-boss-resource-comparison";
import type { SimulationResult } from "../lib/simulation/types";

const savedJson = () => readFileSync("data/simulation/boss-resource-comparison-actions.json", "utf8");

describe("Task 04C-1: Boss E vs G implemented by C", () => {
  it("independently initializes exactly two Boss battles at the fixed baseline", () => {
    expect(BOSS_RESOURCE_SCENARIOS).toEqual([{ enemyId: "boss", strategyId: "E" }, { enemyId: "boss", strategyId: "C" }]);
    const runs = runBossResourceComparison();
    expect(runs).toHaveLength(2);
    for (const run of runs) {
      expect(run.initialState).toEqual(startBattle("boss", createInitialProgress()));
      expect(run.initialState.player).toEqual({ hp: 100, energy: 2, energyCap: 4, upgrades: { blade: 0, core: 0, armor: 0 } });
      expect(run.initialState.enemy.hp).toBe(120);
      expect(run.initialState.enemyAttacksExecuted).toBe(0);
      expect(run.initialState.phase).toBe("ongoing");
    }
    expect(runs[0].initialState).not.toBe(runs[1].initialState);
    expect(runs[0].initialState.player.upgrades).not.toBe(runs[1].initialState.player.upgrades);
  });
  it.each(BOSS_RESOURCE_SCENARIOS)("replays Boss/$strategyId with exact effects and reconciles all statistics", scenario => {
    const run = runBossResourceComparison().find(r => r.summary.strategyId === scenario.strategyId)!;
    const s = run.summary;
    let cursor = startBattle("boss", createInitialProgress());
    const counts = { attack: 0, heavy: 0, defend: 0, charge: 0 };
    let enemyAttacks = 0, normal = 0, special = 0, taken = 0, dealt = 0, rawTaken = 0, rawDealt = 0;
    for (const step of run.actions) {
      expect(step.before).toEqual(cursor);
      expect(step.intentBefore).toEqual(getEnemyIntent(cursor));
      expect(step.action).toBe(STRATEGIES[scenario.strategyId](cursor, step.intentBefore));
      const result = performAction(cursor, step.action!);
      if (!result.accepted) throw new Error(result.reason);
      expect(step.accepted).toBe(true);
      expect(step.error).toBeNull();
      expect(step.after).toEqual(result.state);
      expect(step.effects).toEqual(result.effects);
      counts[step.action!]++;
      enemyAttacks += result.state.enemyAttacksExecuted - cursor.enemyAttacksExecuted;
      taken += Math.max(0, cursor.player.hp) - Math.max(0, result.state.player.hp);
      dealt += Math.max(0, cursor.enemy.hp) - Math.max(0, result.state.enemy.hp);
      rawTaken += cursor.player.hp - result.state.player.hp;
      rawDealt += cursor.enemy.hp - result.state.enemy.hp;
      if (result.effects.enemyIntent !== null) {
        if (result.effects.enemyIntent.kind === "special") special++; else normal++;
      }
      cursor = result.state;
    }
    expect(run.finalState).toEqual(cursor);
    expect(s.outcome).toBe(cursor.phase);
    expect(s.finalPhase).toBe(cursor.phase);
    expect(s.playerActions).toBe(run.actions.length);
    expect(s.actionAttempts).toBe(run.actions.length);
    expect(s.playerActions).toBe(Object.values(counts).reduce((a, b) => a + b, 0));
    expect([s.attackCount, s.heavyCount, s.defendCount, s.chargeCount]).toEqual(Object.values(counts));
    expect(s.enemyAttacks).toBe(enemyAttacks);
    expect(enemyAttacks).toBe(normal + special);
    expect([s.bossNormalAttacks, s.bossSpecialAttacks]).toEqual([normal, special]);
    expect([s.totalDamageTaken, s.totalDamageDealt, s.rawHpLossTaken, s.rawHpLossDealt]).toEqual([taken, dealt, rawTaken, rawDealt]);
    expect(s.totalDamageTaken).toBe(100 - Math.max(0, s.playerHp));
    expect(s.totalDamageDealt).toBe(120 - Math.max(0, s.enemyHp));
    expect(s.overkillDamageTaken).toBe(rawTaken - taken);
    expect(s.overkillDamageDealt).toBe(rawDealt - dealt);
    expect(s.finalEnergy).toBe(cursor.player.energy);
    expect(s.reason).toBeNull();
  });
  it("records the G-to-C mapping and configuration without registering a duplicate policy", () => {
    const experiment = createBossResourceExperiment();
    expect(RESOURCE_STRATEGY_MAPPING).toEqual({ E: "E", G: "C" });
    expect(Object.hasOwn(STRATEGIES, "G")).toBe(false);
    expect(experiment.schemaVersion).toBe(1);
    expect(experiment.engineBaseCommit).toBe("431a324c9797b95060bf2677f71838bbbfe5b2a0");
    expect(experiment.maxActions).toBe(200);
    expect(experiment.config).toEqual(GAME_CONFIG);
    expect(experiment.simulations.map(r => r.summary.strategyLabel)).toEqual(["E", "G (implemented by C)"]);
  });
  it("generates deterministic complete JSON and CSV matching the saved experiment", () => {
    const first = createBossResourceExperiment(), second = createBossResourceExperiment();
    expect(second).toEqual(first);
    expect(JSON.stringify(first, null, 2) + "\n").toBe(savedJson());
    const csv = bossResourceCsv(first.simulations);
    expect(csv).toBe(bossResourceCsv(second.simulations));
    expect(csv).toBe(readFileSync("data/simulation/boss-resource-comparison-results.csv", "utf8"));
    expect(csv.trim().split("\n")).toHaveLength(3);
    expect(csv.split("\n")[0].split(",")).toHaveLength(28);
  });
  it("preserves the original 04A/04B data and reports byte for byte", () => {
    const hashes = {
      "data/simulation/baseline-results.csv": "c2caf08f5e5f74679da37ad6ca9512e3c014585286fc9cfb78881c31f91e6abd",
      "data/simulation/baseline-actions.json": "8f67089be2579ea57e964c4cb2c05175b1ef97081524517343cbc248b75d8e42",
      "data/simulation/strategy-comparison-results.csv": "4f3cbbef2f60f917485c970ca4df5a0ee86f650a2306c74565df35b1ca0174e1",
      "data/simulation/strategy-comparison-actions.json": "6d25226df3525e183d3c0af893b8ce8ec58601ddaef87854036e122651031011",
      "docs/BALANCE_BASELINE.md": "f73c7934a01228ec557c43b4790baa7412376ff622f7e2ab2a914b04ed6be52b",
      "docs/STRATEGY_COMPARISON.md": "38ba0e3b7675ffa485abf693863619f5bdfa3ba248a09d874923d31e0e3380f5",
    };
    runBossResourceComparison();
    for (const [file, expected] of Object.entries(hashes)) expect(createHash("sha256").update(readFileSync(file)).digest("hex")).toBe(expected);
  });
  it.each([
    ["E", "data/simulation/strategy-comparison-actions.json"],
    ["C", "data/simulation/baseline-actions.json"],
  ] as const)("keeps the unchanged %s policy's historical trajectory", (id, file) => {
    const original = (JSON.parse(readFileSync(file, "utf8")) as { simulations: SimulationResult[] }).simulations.find(r => r.summary.enemyId === "boss" && r.summary.strategyId === id)!;
    const run = runBossResourceComparison().find(r => r.summary.strategyId === id)!;
    expect(run.initialState).toEqual(original.initialState);
    expect(run.finalState).toEqual(original.finalState);
    expect(run.actions).toEqual(original.actions);
    expect(run.summary).toMatchObject(original.summary);
  });
});
