import React from "react";
import { GAME_CONFIG } from "../../data/game-config";
import type { ChallengeId } from "../../lib/challenge/controller";
import type { PlayerProgress, UpgradeId } from "../../lib/game/types";
const LABELS = { blade: ["锋刃 · Blade", "攻击与重击基础伤害增量"], core: ["核心 · Core", "能量上限增量"], armor: ["护甲 · Armor", "防御减伤增量"] } as const;
export function UpgradePanel({ progress, encounter, challengeId, onSelect }: { progress: PlayerProgress; encounter: number; challengeId: ChallengeId; onSelect: (id: UpgradeId, encounter: number, challengeId: ChallengeId) => void }) {
  return <section className="upgrade-panel" aria-labelledby="upgrade-title"><h2 id="upgrade-title" tabIndex={-1}>第 {encounter + 1} 战胜利 · 选择一次升级</h2><p>生命不恢复。确认一项后立即进入下一战，能量重置为 2。</p><div className="upgrade-options">{(Object.keys(LABELS) as UpgradeId[]).map(id => <button type="button" key={id} onClick={() => onSelect(id, encounter, challengeId)}><h3>{LABELS[id][0]}</h3><p>当前等级 {progress.upgrades[id]}</p><p>{LABELS[id][1]} +{(id === "blade" ? GAME_CONFIG.upgrades.blade.damage : id === "core" ? GAME_CONFIG.upgrades.core.energyCap : GAME_CONFIG.upgrades.armor.reduction)}</p><span>确认选择</span></button>)}</div></section>;
}
