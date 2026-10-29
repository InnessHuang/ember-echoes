import { ENEMY_LABELS } from "./enemies";
import type { EnemyId } from "../../lib/game/types";
import React from "react";

export function Warrior({ enemy = false }: { enemy?: boolean }) {
  return enemy ? (
    <svg viewBox="0 0 240 270" aria-hidden="true" className="warrior enemy-art">
      <path d="M48 248 75 201 164 201 194 248 156 243 146 216 96 216 86 244Z" fill="#161e27" stroke="#65717a" strokeWidth="2" />
      <path d="M53 207Q38 134 78 97L162 97Q202 137 185 207L124 228Z" fill="#35434c" stroke="#819098" strokeWidth="3" />
      <path d="M120 108 120 222M57 168 120 192 184 168M66 140 120 163 178 140" fill="none" stroke="#18252e" strokeWidth="5" />
      <path d="M81 107Q56 66 72 30L102 65 138 65 166 30Q188 77 158 107Z" fill="#69757a" stroke="#a5aaa5" strokeWidth="2" />
      <path d="M86 83 107 88M133 88 154 83" stroke="#c3a375" strokeWidth="5" />
      <path d="M190 120 208 238M201 213 225 215M208 238 202 263 216 259Z" stroke="#9caaa9" strokeWidth="5" fill="#4d6069" />
      <path d="M43 174 21 207 38 229 62 200" fill="#2b3941" stroke="#7b898c" strokeWidth="3" />
    </svg>
  ) : (
    <svg viewBox="0 0 200 270" aria-hidden="true" className="warrior player-art">
      <path d="M70 219 62 257 79 257 91 222M113 222 123 257 141 257 130 216" fill="#111b25" stroke="#5a727e" strokeWidth="3" />
      <path d="M77 126Q48 154 39 231L98 210 152 231Q144 159 122 126Z" fill="#233946" stroke="#526977" strokeWidth="2" />
      <path d="M83 143 62 224 99 205 115 149 136 224" fill="#172833" />
      <path d="M65 61 84 37 97 54 125 48 143 72 135 119 103 140 69 118Z" fill="#cbd5d1" stroke="#eef0df" strokeWidth="2" />
      <path d="M79 84 93 88 88 106 79 101M112 88 127 81 124 101 113 106" fill="#15252e" />
      <path d="M102 58 98 78 108 111 104 129" fill="none" stroke="#82979c" strokeWidth="2" />
      <path d="M138 175 181 123 186 130 151 186M139 177 153 190" stroke="#a1b7bb" strokeWidth="5" />
      <path d="M77 133 121 134 127 148 70 148Z" fill="#897452" />
    </svg>
  );
}
export function Battlefield({ phase, turn, enemyId = "light" }: { phase: string; turn: number; enemyId?: EnemyId }) {
  return (
    <section className={`battlefield ${phase}`} aria-label={`战场：面具旅人与${ENEMY_LABELS[enemyId].name}对峙`}>
      <RuinBackdrop />
      <div className="distant-arch arch-one" /><div className="distant-arch arch-two" /><div className="distant-arch arch-three" />
      <div className="ruin-pillar pillar-left" /><div className="ruin-pillar pillar-right" />
      <div className="lantern lantern-left" /><div className="lantern lantern-right" />
      <div className="mist" /><div className="ground" />
      <div className="arena-caption"><span>遗忘回廊</span><span>THE FORGOTTEN PASSAGE</span></div>
      <div className="combatant traveler"><Warrior /><span>面具旅人</span></div>
      <div className="combatant beetle"><Warrior enemy /><span>{ENEMY_LABELS[enemyId].name}</span></div>
      <div className="turn-marker">{phase === "ongoing" ? `回合 ${String(turn).padStart(2, "0")} · 由你行动` : "战斗已结束"}</div>
    </section>
  );
}

/** Original silhouette architecture, independent of combat state and external assets. */
function RuinBackdrop() {
  return <svg className="ruin-backdrop" viewBox="0 0 1200 560" preserveAspectRatio="xMidYMax slice" aria-hidden="true">
    <defs>
      <linearGradient id="ruin-stone" x2="0" y2="1"><stop stopColor="#304855"/><stop offset="1" stopColor="#0c1b2a"/></linearGradient>
      <radialGradient id="ruin-glow"><stop stopColor="#dfa96c" stopOpacity=".65"/><stop offset="1" stopColor="#dfa96c" stopOpacity="0"/></radialGradient>
    </defs>
    <path d="M220 520V180Q260 92 300 50Q340 92 380 180V520M820 520V180Q860 92 900 50Q940 92 980 180V520" fill="none" stroke="#233c50" strokeWidth="27"/>
    <path d="M425 510V130Q500 30 600 -35Q700 30 775 130V510Z" fill="#0b1b2b" stroke="#3b5364" strokeWidth="18"/>
    <path d="M460 490V145Q520 65 600 10Q680 65 740 145V490M485 480V155Q540 85 600 48Q660 85 715 155V480M600 48V485M486 220H715M486 330H715" fill="none" stroke="#2d4659" strokeWidth="8"/>
    <path d="m600 70-43 87 43 59 43-59Z" fill="#688699" opacity=".3"/>
    <path d="M390 510 410 370 433 360 451 305 470 360 493 370 510 510M690 510 707 370 730 360 749 305 767 360 790 370 810 510" fill="url(#ruin-stone)" stroke="#3c5260" strokeWidth="3"/>
    <path d="M540 430V313L600 230 660 313V430Z" fill="#142a3a" stroke="#4d616b" strokeWidth="5"/>
    <path d="M565 420V320L581 289 592 320V420M608 420V320L620 289 635 320V420" fill="#be9564" opacity=".85"/>
    <ellipse cx="600" cy="350" rx="150" ry="135" fill="url(#ruin-glow)"/>
    <path d="M330 450H870V466H330ZM355 475H845V489H355Z" fill="#314554"/>
    <g fill="#050e19"><path d="M0 0H1200V20L1155 15 1140 110 1116 28 1050 15 1024 74 1005 21 863 0 800 55 790 0 420 0 407 83 386 23 228 10 212 95 191 20 105 32 81 140 60 32 0 80Z"/>
    <path d="M0 560V330L25 380 14 270 41 317 55 455 95 400 76 465 140 447 100 492 191 480 153 515 235 519 259 545H940L970 519 1032 503 1012 471 1070 482 1046 415 1101 458 1119 350 1138 391 1160 300 1174 460 1200 365V560Z"/></g>
    <g fill="#a5c0cb" opacity=".45"><circle cx="418" cy="218" r="2"/><circle cx="757" cy="245" r="1.5"/><circle cx="881" cy="366" r="2"/><circle cx="338" cy="354" r="1"/><circle cx="660" cy="170" r="1.5"/></g>
    <path d="M0 526 91 522 170 531 250 523 335 529 440 524 530 532 650 524 763 529 870 520 965 529 1065 522 1200 530" fill="none" stroke="#879096" strokeOpacity=".35" strokeWidth="4"/>
  </svg>;
}
