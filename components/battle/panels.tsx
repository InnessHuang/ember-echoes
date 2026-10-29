import React from "react";
import { GAME_CONFIG } from "../../data/game-config";
import { getEnemyIntent } from "../../lib/game/engine";
import type { ActionId, BattleState } from "../../lib/game/types";
import { ENEMY_LABELS } from "./enemies";
import { ACTION_NAMES } from "./session";

export function StatusPanels({ state }: { state: BattleState }) {
  const intent = getEnemyIntent(state);
  const maxEnemyHp = GAME_CONFIG.enemies[state.enemy.id].maxHp;
  return <div className="status-panels">
    <section className="status-panel" aria-label="玩家状态">
      <div className="panel-heading"><span className="eyebrow">THE WANDERER</span><span>面具旅人</span></div>
      <div className="health-label"><span>生命</span><strong>{Math.max(0, state.player.hp)} <small>/ {GAME_CONFIG.player.maxHp}</small></strong></div>
      <meter className="health-meter" min={0} max={GAME_CONFIG.player.maxHp} value={Math.max(0, state.player.hp)} aria-label="玩家生命" />
      <div className="energy-row"><span>能量</span><div className="energy-pips" aria-hidden="true">{Array.from({ length: state.player.energyCap }, (_, i) => <i key={i} className={i < state.player.energy ? "filled" : ""} />)}</div><strong>{state.player.energy}/{state.player.energyCap}</strong></div>
    </section>
    <section className="status-panel enemy-panel" aria-label="敌人状态">
      <div className="panel-heading"><span className="eyebrow">{ENEMY_LABELS[state.enemy.id].title}</span><span>{ENEMY_LABELS[state.enemy.id].name} <small>· {ENEMY_LABELS[state.enemy.id].tag}</small></span></div>
      <div className="health-label"><span>生命</span><strong>{Math.max(0, state.enemy.hp)} <small>/ {maxEnemyHp}</small></strong></div>
      <meter className="health-meter" min={0} max={maxEnemyHp} value={Math.max(0, state.enemy.hp)} aria-label="敌人生命" />
      <p className="intent">{intent ? `下一次意图 · ${intent.kind === "special" ? "特殊攻击" : "普通攻击"} · 预计攻击 ${intent.damage}` : "行动意图 · 战斗结束"}</p>
    </section>
  </div>;
}
const ACTION_DETAILS = {
  attack: "稳住步伐，挥出利刃。", heavy: "消耗能量，击穿甲壳。", defend: "抵挡紧接着的本次攻击。", charge: "暂缓攻势，为下一击蓄能。",
};
const SYMBOLS = { attack: "╱", heavy: "✧", defend: "◇", charge: "◈" };
export function ActionPanel({ state, onAction }: { state: BattleState; onAction: (action: ActionId) => void }) {
  return <section className="actions" aria-label="选择行动">{(Object.keys(ACTION_NAMES) as ActionId[]).map((id, index) => {
    const rule = GAME_CONFIG.actions[id];
    const insufficient = state.player.energy < rule.cost;
    return <button key={id} type="button" className={`action-card ${insufficient ? "unavailable" : ""}`} disabled={state.phase !== "ongoing"} onClick={() => onAction(id)} aria-describedby={`action-${id}-detail`}>
      <div className="action-top"><span className="action-symbol" aria-hidden="true">{SYMBOLS[id]}</span><span className="action-cost">消耗 {rule.cost} 能量</span></div>
      <h3><small>0{index + 1}</small>{ACTION_NAMES[id]}</h3>
      <p className="action-effect">{rule.damage > 0 ? `基础伤害 ${rule.damage}` : id === "defend" ? `本次减伤 ${rule.reduction} · 能量 +${rule.gain}` : `能量 +${rule.gain} · 上限 ${state.player.energyCap}`}</p>
      <p id={`action-${id}-detail`} className="action-description">{insufficient ? "能量不足 · 点击查看原因" : ACTION_DETAILS[id]}</p>
    </button>;
  })}</section>;
}
export function BattleLog({ logs }: { logs: readonly string[] }) {
  return <section className="battle-log" aria-labelledby="log-heading"><h2 id="log-heading">回声手记 <span>BATTLE RECORD</span></h2>{logs.length === 0 ? <p className="empty-log">尚未行动。敌人意图只是预告，攻击尚未发生。</p> : <ol>{logs.map((log, i) => <li key={`${logs.length}-${i}`}><span className="log-dot" />{log}</li>)}</ol>}</section>;
}
export function BattleResult({ phase, onRestart }: { phase: BattleState["phase"]; onRestart: () => void }) {
  if (phase === "ongoing") return null;
  return <section className={`result-panel ${phase}`} aria-labelledby="result-title"><span className="eyebrow">{phase === "victory" ? "A QUIET VICTORY" : "THE EMBER FADES"}</span><h2 id="result-title" tabIndex={-1}>{phase === "victory" ? "余烬未熄" : "回响渐息"}</h2><p>{phase === "victory" ? "挑战胜利 · 三位守卫倒下，遗迹重归寂静。" : "失败 · 你的旅途暂时止步于此。"}</p><button type="button" className="restart-button" onClick={onRestart}>重新开始 <span aria-hidden="true">↻</span></button><small>三战挑战 · 重开恢复全部初始状态</small></section>;
}
