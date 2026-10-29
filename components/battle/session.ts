import { createInitialProgress, performAction, startBattle } from "../../lib/game/engine";
import type { ActionId, BattleState } from "../../lib/game/types";

export const ACTION_NAMES = { attack: "普通攻击", heavy: "重击", defend: "防御", charge: "蓄能" } as const;
export interface BattleSession {
  readonly battle: BattleState;
  readonly logs: readonly string[];
  readonly feedback: string;
}
export type SessionCommand = { type: "action"; action: ActionId } | { type: "restart" };
export function createSession(): BattleSession {
  return { battle: startBattle("light", createInitialProgress()), logs: [], feedback: "遗迹中传来甲壳的回声。观察意图，选择你的行动。" };
}
/** Presentation adapter only: all combat decisions and numbers come from the engine. */
export function sessionReducer(session: BattleSession, command: SessionCommand): BattleSession {
  if (command.type === "restart") return createSession();
  const result = performAction(session.battle, command.action);
  if (!result.accepted) {
    return { ...session, battle: result.state, feedback: result.reason === "insufficient-energy" ? "能量不足，重击未执行。生命、能量与回合均未改变。" : "战斗已结束，请重新开始。" };
  }
  const { state, effects } = result;
  const attack = effects.playerDamage > 0 ? `造成 ${effects.playerDamage} 点伤害，敌人剩余生命 ${Math.max(0, state.enemy.hp)}。` : "";
  const response = effects.enemyIntent
    ? `敌人实际攻击 ${effects.enemyIntent.damage}，你实际承伤 ${effects.damageTaken}。`
    : "敌人被击败，没有反击。";
  const message = `第 ${session.battle.turn} 回合 · ${ACTION_NAMES[command.action]}。${attack}${response}能量 ${state.player.energy}/${state.player.energyCap}。`;
  return { battle: state, feedback: message, logs: [message, ...session.logs].slice(0, 6) };
}
