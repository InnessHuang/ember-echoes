"use client";

import React, { useEffect, useReducer } from "react";
import { Battlefield } from "./battlefield";
import { ActionPanel, BattleLog, BattleResult, StatusPanels } from "./panels";
import { UpgradePanel } from "./upgrade-panel";
import { ENEMY_LABELS } from "./enemies";
import { createSession, sessionReducer } from "./session";

export default function BattleDemo() {
  const [session, dispatch] = useReducer(sessionReducer, undefined, () => createSession());
  const { battle } = session;
  useEffect(() => {
    if (session.phase === "upgrade") document.getElementById("upgrade-title")?.focus();
    if (session.phase === "victory" || session.phase === "defeat") document.getElementById("result-title")?.focus();
  }, [session.phase]);
  return <main className="game-shell">
    <header className="game-header"><div className="brand"><span className="brand-sigil" aria-hidden="true">◇</span><div><h1>余烬回响</h1><p>EMBER ECHOES</p></div></div><div className="encounter"><span className="eyebrow">ENCOUNTER 0{session.encounter + 1}</span><p>第 {session.encounter + 1} 场战斗 · {ENEMY_LABELS[battle.enemy.id].name}</p></div><span className={`phase-badge ${battle.phase}`}>{session.phase === "battle" ? "交锋中" : session.phase === "upgrade" ? "等待升级" : session.phase === "victory" ? "挑战成功" : "挑战失败"}</span></header>
    <div className="intro-line"><span>在寂静深处，听见尚未熄灭的回声。</span><details className="help"><summary>如何战斗 <span aria-hidden="true">＋</span></summary><div><h2>让每一次选择，都留下回响。</h2><p>能量是行动资源。重击需要足够能量；防御降低紧接着的本次攻击伤害，同时积蓄能量；蓄能为后续行动做准备。</p><p>先观察敌人的下一次意图，再选择行动。意图是预计攻击值，实际承伤会在结算后显示。敌人被击败时不会反击。</p><p>依次挑战轻型、重型与 Boss。前两战胜利后各升级一次，Boss 胜利即通关。生命不恢复，新战能量重置为 2，升级保留。可以用 Tab 与 Enter 操作按钮。</p></div></details></div>
    <div className="encounter-scene"><StatusPanels state={battle} />
    <div className="arena-wrap"><Battlefield phase={battle.phase} turn={battle.turn} enemyId={battle.enemy.id} /><BattleResult phase={session.phase === "victory" || session.phase === "defeat" ? session.phase : "ongoing"} onRestart={() => dispatch({ type: "restart", challengeId: Symbol("challenge") })} /></div></div>
    {session.phase === "upgrade" && <UpgradePanel progress={battle.player} encounter={session.encounter} challengeId={session.challengeId} onSelect={(upgrade, encounter, challengeId) => dispatch({ type: "upgrade", upgrade, encounter, challengeId })} />}
    <section className="decision-area"><div className="section-heading"><h2>选择你的行动</h2><span>先观察，再出手</span></div><p>锋刃 {battle.player.upgrades.blade} · 核心 {battle.player.upgrades.core} · 护甲 {battle.player.upgrades.armor}（卡片显示基础值，实际伤害见结算）</p><ActionPanel state={battle} onAction={action => dispatch({ type: "action", action })} /><p className="battle-feedback" role="status" aria-live="polite" aria-atomic="true">{session.feedback}</p></section>
    <BattleLog logs={session.logs} />
    <footer className="game-footer"><span>原创回合制战斗 · 数值策划作品集</span><span>三战挑战 DEMO <i aria-hidden="true">◇</i> 每个选择都有重量</span></footer>
  </main>;
}
