"use client";

import React, { useReducer } from "react";
import { Battlefield } from "./battlefield";
import { ActionPanel, BattleLog, BattleResult, StatusPanels } from "./panels";
import { createSession, sessionReducer } from "./session";

export default function BattleDemo() {
  const [session, dispatch] = useReducer(sessionReducer, undefined, createSession);
  const { battle } = session;
  return <main className="game-shell">
    <header className="game-header"><div className="brand"><span className="brand-sigil" aria-hidden="true">◇</span><div><h1>余烬回响</h1><p>EMBER ECHOES</p></div></div><div className="encounter"><span className="eyebrow">ENCOUNTER 01</span><p>第一场战斗 · 失落的战士</p></div><span className={`phase-badge ${battle.phase}`}>{battle.phase === "ongoing" ? "交锋中" : battle.phase === "victory" ? "胜利" : "失败"}</span></header>
    <div className="intro-line"><span>在寂静深处，听见尚未熄灭的回声。</span><details className="help"><summary>如何战斗 <span aria-hidden="true">＋</span></summary><div><h2>让每一次选择，都留下回响。</h2><p>能量是行动资源。重击需要足够能量；防御降低紧接着的本次攻击伤害，同时积蓄能量；蓄能为后续行动做准备。</p><p>先观察敌人的下一次意图，再选择行动。意图是预计攻击值，实际承伤会在结算后显示。敌人被击败时不会反击。</p><p>这是单场战斗，没有自动回血、战后升级或下一场流程。可以用 Tab 与 Enter 操作按钮。</p></div></details></div>
    <div className="encounter-scene"><StatusPanels state={battle} />
    <div className="arena-wrap"><Battlefield phase={battle.phase} turn={battle.turn} /><BattleResult phase={battle.phase} onRestart={() => dispatch({ type: "restart" })} /></div></div>
    <section className="decision-area"><div className="section-heading"><h2>选择你的行动</h2><span>先观察，再出手</span></div><ActionPanel state={battle} onAction={action => dispatch({ type: "action", action })} /><p className="battle-feedback" role="status" aria-live="polite" aria-atomic="true">{session.feedback}</p></section>
    <BattleLog logs={session.logs} />
    <footer className="game-footer"><span>原创回合制战斗 · 数值策划作品集</span><span>单场战斗 DEMO <i aria-hidden="true">◇</i> 每个选择都有重量</span></footer>
  </main>;
}
