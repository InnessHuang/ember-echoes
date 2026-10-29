import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import BattleDemo from "../components/battle/battle-demo";
import { ActionPanel, BattleLog, BattleResult, StatusPanels } from "../components/battle/panels";
import { createSession, sessionReducer } from "../components/battle/session";
import * as engine from "../lib/game/engine";
import type { ActionId } from "../lib/game/types";

function markup(session = createSession()) {
  return renderToStaticMarkup(createElement(StatusPanels, { state: session.battle }));
}
function click(session: ReturnType<typeof createSession>, action: ActionId) {
  // Invoke the actual rendered button callback, then render its resulting state.
  let next = session;
  const panel = ActionPanel({ state: session.battle, onAction: id => { next = sessionReducer(session, { type: "action", action: id }); } });
  const button = panel.props.children.find((element: { key: string }) => element.key === action);
  button.props.onClick();
  return next;
}

describe("battle UI with existing node-only tools", () => {
  it("renders the initial page and engine state", () => {
    const html = renderToStaticMarkup(createElement(BattleDemo));
    expect(html).toContain("余烬回响");
    expect(html).toContain("失落的战士");
    expect(html).toContain('value="100"');
    expect(html).toContain('value="42"');
    expect(html).toContain("2/4");
    expect(html).toContain("预计攻击 9");
    expect(html).toContain("如何战斗");
  });
  it("renders all action names and configured costs and effects", () => {
    const html = renderToStaticMarkup(createElement(ActionPanel, { state: createSession().battle, onAction: () => {} }));
    for (const name of ["普通攻击", "重击", "防御", "蓄能"]) expect(html).toContain(name);
    expect(html).toContain("消耗 2 能量");
    expect(html.match(/消耗 0 能量/g)).toHaveLength(3);
    for (const description of ["伤害 12", "伤害 25", "本次减伤 12 · 能量 +1", "能量 +2 · 上限 4"]) expect(html).toContain(description);
  });
  it("routes the attack button to the engine and renders the new state", () => {
    const spy = vi.spyOn(engine, "performAction");
    try {
      const session = createSession();
      const next = click(session, "attack");
      expect(spy).toHaveBeenCalledWith(session.battle, "attack");
      expect(markup(next)).toContain('value="30"');
      expect(markup(next)).toContain('value="91"');
      expect(next.logs[0]).toContain("造成 12 点伤害");
      expect(next.logs[0]).toContain("实际承伤 9");
    } finally { spy.mockRestore(); }
  });
  it("keeps insufficient heavy clickable for explanation and preserves combat state", () => {
    const session = click(createSession(), "heavy");
    const next = click(session, "heavy");
    expect(next.battle).toBe(session.battle);
    expect(next.logs).toBe(session.logs);
    expect(next.feedback).toContain("能量不足");
    const html = renderToStaticMarkup(createElement(ActionPanel, { state: next.battle, onAction: () => {} }));
    expect(html).toContain("能量不足 · 点击查看原因");
    expect(html).not.toContain("disabled");
  });
  it("shows defense actual damage separately from attack strength", () => {
    const next = click(createSession(), "defend");
    expect(next.feedback).toContain("实际攻击 9，你实际承伤 0");
    expect(markup(next)).toContain('value="100"');
    expect(markup(next)).toContain("3/4");
    expect(click(next, "attack").battle.player.hp).toBe(91);
  });
  it("charge displays capped energy from the engine", () => {
    const next = click(click(createSession(), "charge"), "charge");
    expect(markup(next)).toContain("4/4");
    expect(next.feedback).toContain("能量 4/4");
  });
  it("winning attack displays no retaliation and only the actual prior attacks", () => {
    let session = createSession();
    for (const action of ["heavy", "attack", "attack"] as const) session = click(session, action);
    expect(session.battle.phase).toBe("victory");
    expect(session.battle.player.hp).toBe(82);
    expect(session.battle.enemyAttacksExecuted).toBe(2);
    expect(session.logs[0]).toContain("敌人被击败，没有反击");
    expect(session.logs[0]).not.toContain("实际攻击");
    expect(markup(session)).toContain("战斗结束");
  });
  it.each(["victory", "defeat"] as const)("disables every action after %s and refuses further state changes", phase => {
    let session = createSession();
    if (phase === "victory") for (const action of ["heavy", "attack", "attack"] as const) session = click(session, action);
    else for (let i = 0; i < 12; i++) session = click(session, "charge");
    expect(session.battle.phase).toBe(phase);
    const html = renderToStaticMarkup(createElement(ActionPanel, { state: session.battle, onAction: () => {} }));
    expect(html.match(/disabled=""/g)).toHaveLength(4);
    expect(sessionReducer(session, { type: "action", action: "attack" }).battle).toBe(session.battle);
    expect(renderToStaticMarkup(createElement(BattleResult, { phase, onRestart: () => {} }))).toContain(phase === "victory" ? "胜利" : "失败");
  });
  it("result restart callback restores initial battle, feedback and empty log", () => {
    let session = createSession();
    for (const action of ["heavy", "attack", "attack"] as const) session = click(session, action);
    const result = BattleResult({ phase: session.battle.phase, onRestart: () => { session = sessionReducer(session, { type: "restart" }); } });
    const button = result!.props.children.find((child: { type: string }) => child.type === "button");
    button.props.onClick();
    expect(session).toEqual(createSession());
  });
  it("never records a preview as an executed attack", () => {
    const session = createSession();
    engine.getEnemyIntent(session.battle);
    expect(session.logs).toEqual([]);
    const html = renderToStaticMarkup(createElement(BattleLog, { logs: session.logs }));
    expect(html).toContain("攻击尚未发生");
    expect(html).not.toContain("实际攻击");
  });
  it("core interaction works with network and randomness made unavailable", () => {
    const random = vi.spyOn(Math, "random").mockImplementation(() => { throw new Error("random forbidden"); });
    const network = vi.spyOn(globalThis, "fetch").mockImplementation(() => { throw new Error("network forbidden"); });
    try {
      const next = click(createSession(), "attack");
      expect(next.battle.enemy.hp).toBe(30);
      expect(network).not.toHaveBeenCalled();
      expect(random).not.toHaveBeenCalled();
    } finally { random.mockRestore(); network.mockRestore(); }
  });
});
