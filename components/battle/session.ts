import { act, createChallenge, selectUpgrade, type ChallengeId, type ChallengeState } from "../../lib/challenge/controller";
import type { ActionId, UpgradeId } from "../../lib/game/types";

export const ACTION_NAMES = { attack: "普通攻击", heavy: "重击", defend: "防御", charge: "蓄能" } as const;
export interface BattleSession extends ChallengeState {
  readonly logs: readonly string[];
  readonly feedback: string;
}
export type SessionCommand = { type: "action"; action: ActionId } | { type: "restart"; challengeId: ChallengeId } | { type: "upgrade"; upgrade: UpgradeId; encounter: number; challengeId: ChallengeId };
export function createSession(challengeId: ChallengeId = Symbol("challenge")): BattleSession {
  return { ...createChallenge(challengeId), logs: [], feedback: "遗迹中传来甲壳的回声。观察意图，选择你的行动。" };
}
/** Presentation adapter only: all combat decisions and numbers come from the engine. */
export function sessionReducer(session: BattleSession, command: SessionCommand): BattleSession {
  if (command.type === "restart") return createSession(command.challengeId);
  if (command.type === "upgrade") {
    const next = selectUpgrade(session, command.upgrade, command.encounter, command.challengeId);
    if (next === session) return session;
    const feedback = `${({ blade: "锋刃", core: "核心", armor: "护甲" })[command.upgrade]}升级已确认，进入第 ${next.encounter + 1} 战。生命继承，当前能量重置为 ${next.battle.player.energy}。`;
    return { ...next, feedback, logs: [feedback, ...session.logs].slice(0, 6) };
  }
  const transition = act(session, command.action);
  const result = transition.result;
  if (!result) return session;
  if (!result.accepted) {
    return { ...session, battle: result.state, feedback: result.reason === "insufficient-energy" ? "能量不足，重击未执行。生命、能量与回合均未改变。" : "战斗已结束，请重新开始。" };
  }
  const { state, effects } = result;
  const attack = effects.playerDamage > 0 ? `造成 ${effects.playerDamage} 点伤害，敌人剩余生命 ${Math.max(0, state.enemy.hp)}。` : "";
  const response = effects.enemyIntent
    ? `敌人实际攻击 ${effects.enemyIntent.damage}，你实际承伤 ${effects.damageTaken}。`
    : "敌人被击败，没有反击。";
  const message = `第 ${session.encounter + 1} 战 · 第 ${session.battle.turn} 回合 · ${ACTION_NAMES[command.action]}。${attack}${response}能量 ${state.player.energy}/${state.player.energyCap}。`;
  return { ...transition.state, feedback: message, logs: [message, ...session.logs].slice(0, 6) };
}
