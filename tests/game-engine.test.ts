import { describe, expect, it } from "vitest";
import { GAME_CONFIG } from "../data/game-config";
import { applyUpgrade, createInitialProgress, getEnemyIntent, getPlayerProgress, performAction, startBattle } from "../lib/game/engine";
import type { ActionId, BattleState, EnemyId, PlayerProgress } from "../lib/game/types";

function battle(enemy: EnemyId = "light") { return startBattle(enemy, createInitialProgress()); }
function act(state: BattleState, action: ActionId) {
  const result = performAction(state, action);
  expect(result.accepted).toBe(true);
  if (!result.accepted) throw new Error(result.reason);
  return result;
}
function freeze<T>(value: T): T {
  if (value !== null && typeof value === "object") {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}

describe("deterministic combat", () => {
  it("starts with 100 HP and 2/4 energy and independent progress", () => {
    expect(battle().player).toEqual({ hp: 100, energy: 2, energyCap: 4, upgrades: { blade: 0, core: 0, armor: 0 } });
    expect(createInitialProgress().upgrades).not.toBe(createInitialProgress().upgrades);
  });
  it.each([["attack", 12, 2], ["heavy", 25, 0]] as const)("resolves %s damage and energy", (action, damage, energy) => {
    const result = act(battle(), action);
    expect(result.state.enemy.hp).toBe(42 - damage);
    expect(result.state.player.energy).toBe(energy);
    expect(result.state.player.hp).toBe(91);
    expect(result.state.turn).toBe(2);
  });
  it.each([0, 1])("rejects heavy at %i energy without any state change", energy => {
    const base = battle();
    const state = freeze({ ...base, player: { ...base.player, energy } });
    const before = structuredClone(state);
    expect(performAction(state, "heavy")).toEqual({ accepted: false, reason: "insufficient-energy", state });
    expect(performAction(state, "heavy").state).toBe(state);
    expect(state).toEqual(before);
  });
  it("caps charge at 4 from 3", () => {
    const state = battle();
    expect(act({ ...state, player: { ...state.player, energy: 3 } }, "charge").state.player.energy).toBe(4);
  });
  it("defends at full energy without overflow", () => {
    const state = battle();
    const result = act({ ...state, player: { ...state.player, energy: 4 } }, "defend");
    expect(result.state.player).toMatchObject({ hp: 100, energy: 4 });
    expect(result.effects.damageTaken).toBe(0);
  });
  it.each([["light", 0, 0], ["heavy", 0, 1], ["boss", 2, 10]] as const)("defends against %s", (enemy, count, damage) => {
    const result = act({ ...battle(enemy), enemyAttacksExecuted: count }, "defend");
    expect(result.effects.damageTaken).toBe(damage);
    expect(result.state.player.hp).toBe(100 - damage);
    expect(result.state.player.energy).toBe(3);
  });
  it("clears defense before the next action", () => {
    const state = act(battle(), "defend").state;
    expect(act(state, "attack").state.player.hp).toBe(91);
  });
  it.each([12, 11])("wins at enemy HP %i without retaliation", hp => {
    const state = battle();
    const result = act({ ...state, enemy: { ...state.enemy, hp } }, "attack");
    expect(result.state.phase).toBe("victory");
    expect(result.state.enemy.hp).toBe(hp - 12);
    expect(result.state.player.hp).toBe(100);
    expect(result.effects.enemyIntent).toBeNull();
    expect(result.state.enemyAttacksExecuted).toBe(0);
  });
  it("previews and executes the first six Boss attacks", () => {
    let state = battle("boss");
    for (const [index, damage] of [12, 12, 22, 12, 12, 22].entries()) {
      const expected = { kind: damage === 22 ? "special" : "normal", damage, attackNumber: index + 1 };
      expect(getEnemyIntent(state)).toEqual(expected);
      const result = act(state, "charge");
      expect(result.effects.enemyIntent).toEqual(expected);
      expect(result.state.enemyAttacksExecuted).toBe(index + 1);
      state = result.state;
    }
    expect(state.player.hp).toBe(8);
  });
  it("does not increment Boss count on a killing blow", () => {
    const base = battle("boss");
    const result = act({ ...base, enemy: { id: "boss", hp: 12 }, enemyAttacksExecuted: 2 }, "attack");
    expect(result.state.enemyAttacksExecuted).toBe(2);
    expect(getEnemyIntent(result.state)).toBeNull();
  });
  it("counts fully blocked Boss attacks", () => {
    const result = act(battle("boss"), "defend");
    expect(result.effects.damageTaken).toBe(0);
    expect(result.state.enemyAttacksExecuted).toBe(1);
  });
  it.each([["attack", 15], ["heavy", 28]] as const)("blade boosts %s", (action, damage) => {
    const result = act(startBattle("boss", applyUpgrade(createInitialProgress(), "blade")), action);
    expect(result.effects.playerDamage).toBe(damage);
    expect(result.state.enemy.hp).toBe(120 - damage);
  });
  it("accumulates repeated upgrades without changing base configuration", () => {
    const before = structuredClone(GAME_CONFIG);
    let progress = createInitialProgress();
    for (let i = 0; i < 2; i++) for (const upgrade of ["blade", "core", "armor"] as const) progress = applyUpgrade(progress, upgrade);
    const state = startBattle("boss", progress);
    expect(state.player.upgrades).toEqual({ blade: 2, core: 2, armor: 2 });
    expect(state.player.energyCap).toBe(6);
    expect(act(state, "attack").effects.playerDamage).toBe(18);
    expect(act(state, "heavy").effects.playerDamage).toBe(31);
    expect(act({ ...state, enemyAttacksExecuted: 2 }, "defend").effects.damageTaken).toBe(0);
    expect(GAME_CONFIG).toEqual(before);
  });
  it("core increases capacity without supplying current energy", () => {
    const progress = applyUpgrade(createInitialProgress(), "core");
    expect(progress).not.toHaveProperty("energy");
    const state = startBattle("light", progress);
    expect(state.player).toMatchObject({ energy: 2, energyCap: 5 });
    expect(act({ ...state, player: { ...state.player, energy: 4 } }, "charge").state.player.energy).toBe(5);
  });
  it("armor gives 18 reduction", () => {
    const state = startBattle("boss", applyUpgrade(createInitialProgress(), "armor"));
    expect(act({ ...state, enemyAttacksExecuted: 2 }, "defend").effects.damageTaken).toBe(4);
  });
  it.each([13, 12])("immediately loses from %i HP against heavy", hp => {
    const base = battle("heavy");
    const state = act({ ...base, player: { ...base.player, hp } }, "charge").state;
    expect(state.player.hp).toBe(hp - 13);
    expect(state.phase).toBe("defeat");
    expect(state.enemyAttacksExecuted).toBe(1);
    expect(getEnemyIntent(state)).toBeNull();
    expect(performAction(state, "attack")).toEqual({ accepted: false, reason: "battle-ended", state });
    expect(performAction(state, "attack").state).toBe(state);
  });
  it("rejects input after victory", () => {
    const state = act({ ...battle(), enemy: { id: "light", hp: 1 } }, "attack").state;
    expect(performAction(state, "charge")).toEqual({ accepted: false, reason: "battle-ended", state });
  });
  it("preserves 37 HP and upgrades while resetting energy, enemy and Boss count", () => {
    const base = startBattle("boss", applyUpgrade(applyUpgrade(createInitialProgress(), "core"), "blade"));
    const previous: BattleState = { ...base, player: { ...base.player, hp: 37, energy: 5 }, enemyAttacksExecuted: 6, turn: 7 };
    const progress = getPlayerProgress(previous);
    expect(progress).not.toHaveProperty("energy");
    const next = startBattle("boss", progress);
    expect(next.player).toEqual({ hp: 37, energy: 2, energyCap: 5, upgrades: { blade: 1, core: 1, armor: 0 } });
    expect(next.enemy.hp).toBe(120);
    expect(next.turn).toBe(1);
    expect(next.enemyAttacksExecuted).toBe(0);
    expect(getEnemyIntent(next)?.kind).toBe("normal");
  });
  it("restarts a challenge with all initial values", () => {
    const lost = startBattle("boss", { hp: 0, upgrades: { blade: 2, core: 2, armor: 2 } });
    expect(lost.phase).toBe("defeat");
    expect(startBattle("light", createInitialProgress())).toEqual(battle());
  });
  it("all public functions preserve frozen inputs and return detached progress", () => {
    const progress: PlayerProgress = freeze({ hp: 37, upgrades: { blade: 1, core: 1, armor: 1 } });
    const snapshot = structuredClone(progress);
    const upgraded = applyUpgrade(progress, "armor");
    const state = freeze(startBattle("boss", progress));
    const before = structuredClone(state);
    expect(upgraded.upgrades.armor).toBe(2);
    getEnemyIntent(state);
    act(state, "attack");
    const extracted = getPlayerProgress(state);
    expect(extracted.upgrades).not.toBe(state.player.upgrades);
    expect(state.player.upgrades).not.toBe(progress.upgrades);
    expect(progress).toEqual(snapshot);
    expect(state).toEqual(before);
  });
  it("rejects an unknown runtime action without advancing state", () => {
    const state = freeze(battle());
    expect(performAction(state, "invalid" as ActionId)).toEqual({ accepted: false, reason: "unknown-action", state });
  });
});
