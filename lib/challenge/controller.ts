import { applyUpgrade, createInitialProgress, getEnemyIntent, getPlayerProgress, performAction, startBattle } from "../game/engine";
import type { ActionId, ActionResult, BattleState, UpgradeId } from "../game/types";

export const ENCOUNTERS = ["light", "heavy", "boss"] as const;
export type ChallengePhase = "battle" | "upgrade" | "victory" | "defeat";
/** Opaque in-memory identity, created by the session/event boundary without randomness. */
export type ChallengeId = symbol;
export interface ChallengeState {
  readonly challengeId: ChallengeId;
  readonly encounter: number;
  readonly phase: ChallengePhase;
  /** The engine state is the authoritative source of HP and persistent upgrades. */
  readonly battle: BattleState;
}
export function createChallenge(challengeId: ChallengeId): ChallengeState {
  return { challengeId, encounter: 0, phase: "battle", battle: startBattle("light", createInitialProgress()) };
}
export function challengeIntent(state: ChallengeState) {
  return state.phase === "battle" ? getEnemyIntent(state.battle) : null;
}
export function act(state: ChallengeState, action: ActionId): { state: ChallengeState; result: ActionResult | null } {
  if (state.phase !== "battle") return { state, result: null };
  const result = performAction(state.battle, action);
  if (!result.accepted) return { state, result };
  const phase = result.state.phase === "defeat" ? "defeat" : result.state.phase === "victory" ? state.encounter === 2 ? "victory" : "upgrade" : "battle";
  return { state: { ...state, battle: result.state, phase }, result };
}
/** Both challenge identity and encounter are required: old runs cannot consume a new upgrade. */
export function selectUpgrade(state: ChallengeState, upgrade: UpgradeId, encounter: number, challengeId: ChallengeId): ChallengeState {
  if (state.challengeId !== challengeId) return state;
  if (state.phase !== "upgrade") return state;
  if (state.encounter !== encounter || !Number.isInteger(encounter) || encounter < 0 || encounter > 1) return state;
  if (!["blade", "core", "armor"].includes(upgrade)) return state;
  const next = state.encounter + 1;
  const progress = applyUpgrade(getPlayerProgress(state.battle), upgrade);
  return { challengeId: state.challengeId, encounter: next, phase: "battle", battle: startBattle(ENCOUNTERS[next], progress) };
}
