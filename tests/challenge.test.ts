import { describe, expect, it } from "vitest";
import { GAME_CONFIG } from "../data/game-config";
import { act, challengeIntent, createChallenge, selectUpgrade, type ChallengeState } from "../lib/challenge/controller";
import { createSession, sessionReducer } from "../components/battle/session";
import { performAction } from "../lib/game/engine";
import type { UpgradeId } from "../lib/game/types";

function win(state: ChallengeState): ChallengeState {
  for (let n = 0; n < 200 && state.phase === "battle"; n++) {
    state = act(state, state.battle.player.energy >= GAME_CONFIG.actions.heavy.cost ? "heavy" : "defend").state;
  }
  return state;
}
function lose(state: ChallengeState): ChallengeState {
  for (let n = 0; n < 200 && state.phase === "battle"; n++) state = act(state, "charge").state;
  return state;
}
describe("three-battle challenge", () => {
  it("starts with independent, complete initial progress and a real intent", () => {
    const a = createChallenge(Symbol("test challenge")), b = createChallenge(Symbol("test challenge"));
    expect(a.battle).toEqual(b.battle); expect(a.challengeId).not.toBe(b.challengeId); expect(a).not.toBe(b); expect(a.battle.player.upgrades).not.toBe(b.battle.player.upgrades);
    expect(a).toMatchObject({ encounter: 0, phase: "battle", battle: { player: { hp: 100, energy: 2, energyCap: 4, upgrades: { blade: 0, core: 0, armor: 0 } }, enemy: { id: "light", hp: 42 }, turn: 1, enemyAttacksExecuted: 0 } });
    expect(challengeIntent(a)?.damage).toBe(9);
  });
  it("completes all three battles using the real engine and exactly two upgrades", () => {
    let state = createChallenge(Symbol("test challenge"));
    for (const [index, enemy] of ["light", "heavy", "boss"].entries()) {
      expect(state.encounter).toBe(index); expect(state.battle.enemy.id).toBe(enemy);
      state = win(state);
      expect(state.phase).toBe(index === 2 ? "victory" : "upgrade");
      expect(state.battle.phase).toBe("victory");
      expect(challengeIntent(state)).toBeNull();
      if (index < 2) {
        expect(act(state, "attack").state).toBe(state);
        const hp = state.battle.player.hp;
        state = selectUpgrade(state, "armor", index, state.challengeId);
        expect(state.battle.player.hp).toBe(hp);
        expect(state.battle.player.energy).toBe(2);
        expect(state.battle.player.upgrades.armor).toBe(index + 1);
        expect(state.battle.turn).toBe(1); expect(state.battle.enemyAttacksExecuted).toBe(0);
      }
    }
    expect(state.battle.player.hp).toBe(17);
    expect(state.battle.enemy.hp).toBeLessThanOrEqual(0);
    expect(selectUpgrade(state, "armor", 2, state.challengeId)).toBe(state);
  });
  it.each([0, 1, 2])("a real defeat at encounter %i ends the challenge", target => {
    let state = createChallenge(Symbol("test challenge"));
    for (let n = 0; n < target; n++) state = selectUpgrade(win(state), "armor", n, state.challengeId);
    state = lose(state);
    expect(state.phase).toBe("defeat"); expect(state.encounter).toBe(target);
    expect(act(state, "attack").state).toBe(state);
    expect(selectUpgrade(state, "blade", target, state.challengeId)).toBe(state);
  });
  it.each<UpgradeId>(["blade", "core", "armor"])("applies and accumulates %s without healing", upgrade => {
    let state = win(createChallenge(Symbol("test challenge")));
    const hp = state.battle.player.hp;
    state = selectUpgrade(state, upgrade, 0, state.challengeId);
    expect(state.battle.player.hp).toBe(hp);
    expect(state.battle.player.upgrades[upgrade]).toBe(1);
    // A second authentic victory can be costly without armor; use the same real-engine policy.
    state = win(state);
    expect(state.phase).toBe("upgrade");
    const nextHp = state.battle.player.hp;
    state = selectUpgrade(state, upgrade, 1, state.challengeId);
    expect(state.battle.player.upgrades[upgrade]).toBe(2);
    expect(state.battle.player.hp).toBe(nextHp);
    expect(state.battle.player.energyCap).toBe(upgrade === "core" ? 6 : 4);
  });
  it("rejects wrong phases, repeated selections and stale encounter tokens", () => {
    const initial = createChallenge(Symbol("test challenge")); expect(selectUpgrade(initial, "blade", 0, initial.challengeId)).toBe(initial);
    const first = win(initial); expect(selectUpgrade(first, "blade", 1, first.challengeId)).toBe(first);
    const next = selectUpgrade(first, "armor", 0, first.challengeId);
    expect(selectUpgrade(next, "armor", 0, next.challengeId)).toBe(next);
    const second = win(next); expect(selectUpgrade(second, "armor", 0, second.challengeId)).toBe(second);
    expect(selectUpgrade(second, "armor", 1, second.challengeId).battle.player.upgrades.armor).toBe(2);
  });
  it("returns the engine result without mutating input; rejected actions cannot advance", () => {
    const initial = createChallenge(Symbol("test challenge")), snapshot = { ...initial, battle: structuredClone(initial.battle) };
    const first = act(initial, "heavy");
    expect(first.result).toEqual(performAction(initial.battle, "heavy")); expect(initial).toEqual(snapshot);
    const rejected = act(first.state, "heavy");
    expect(rejected.result?.accepted).toBe(false); expect(rejected.state).toBe(first.state);
  });
  it("rejects an old challenge upgrade after restart at the same encounter", () => {
    let first = createSession();
    for (let i = 0; i < 200 && first.phase === "battle"; i++) first = sessionReducer(first, { type: "action", action: first.battle.player.energy >= 2 ? "heavy" : "defend" });
    expect(first.phase).toBe("upgrade");
    const oldCommand = { type: "upgrade", upgrade: "armor", encounter: 0, challengeId: first.challengeId } as const;
    let second = sessionReducer(first, { type: "restart", challengeId: Symbol("next challenge") });
    for (let i = 0; i < 200 && second.phase === "battle"; i++) second = sessionReducer(second, { type: "action", action: second.battle.player.energy >= 2 ? "heavy" : "defend" });
    expect(second.phase).toBe("upgrade"); expect(second.challengeId).not.toBe(first.challengeId);
    const before = { ...second, battle: structuredClone(second.battle), logs: [...second.logs] };
    expect(sessionReducer(second, oldCommand)).toBe(second); expect(second).toEqual(before);
    const command = { ...oldCommand, challengeId: second.challengeId };
    const upgraded = sessionReducer(second, command);
    expect(upgraded.phase).toBe("battle"); expect(upgraded.battle.player.upgrades.armor).toBe(1);
    expect(sessionReducer(upgraded, command)).toBe(upgraded);
  });
  it("rejects illegal upgrade IDs without changing any state", () => {
    const state = win(createChallenge(Symbol("challenge")));
    expect(selectUpgrade(state, "unknown" as UpgradeId, 0, state.challengeId)).toBe(state);
  });
  it.each(["victory", "defeat", "upgrade"] as const)("actually restarts from %s and clears all session state", phase => {
    let session = createSession();
    const play = (lose = false) => {
      for (let n = 0; n < 200 && session.phase === "battle"; n++) session = sessionReducer(session, { type: "action", action: lose ? "charge" : session.battle.player.energy >= 2 ? "heavy" : "defend" });
    };
    play();
    if (phase !== "upgrade") {
      session = sessionReducer(session, { type: "upgrade", upgrade: "armor", encounter: 0, challengeId: session.challengeId });
      play(phase === "defeat");
      if (phase === "victory") {
        session = sessionReducer(session, { type: "upgrade", upgrade: "armor", encounter: 1, challengeId: session.challengeId });
        play();
      }
    }
    expect(session.phase).toBe(phase); expect(session.logs.length).toBeGreaterThan(0);
    expect(sessionReducer(session, { type: "action", action: "attack" })).toBe(session);
    if (phase !== "upgrade") expect(sessionReducer(session, { type: "upgrade", upgrade: "blade", encounter: session.encounter, challengeId: session.challengeId })).toBe(session);
    const oldId = session.challengeId, newId = Symbol("restart");
    const restarted = sessionReducer(session, { type: "restart", challengeId: newId });
    expect(restarted.challengeId).toBe(newId); expect(newId).not.toBe(oldId);
    expect(restarted).toEqual(createSession(newId));
    expect(restarted).toMatchObject({ phase: "battle", encounter: 0, logs: [], battle: { phase: "ongoing", turn: 1, enemyAttacksExecuted: 0, enemy: { id: "light", hp: 42 }, player: { hp: 100, energy: 2, energyCap: 4, upgrades: { blade: 0, core: 0, armor: 0 } } } });
  });
});
