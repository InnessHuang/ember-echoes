import { GAME_CONFIG } from "../../../data/game-config";
import { getEnemyIntent, performAction } from "../../game/engine";
import type { ActionId } from "../../game/types";
import { validateMechanism, type DefenseMechanism } from "./config";
import type { R2State } from "./mechanics";
import type { R2Decision } from "./strategies";

export const ADAPTIVE_DEFINITIONS = Object.freeze({
  "R2-adaptive-D-v1": "Kill with attack then heavy if possible. Otherwise heavy/attack. If that is lethal, defend only if current decayed mitigation saves life; unaffordable saving defense falls back to charge. No defense with zero useful mitigation.",
  "R2-adaptive-E-v1": "Kill first. Below heavy cost prefer surviving charge. At sufficient energy, proactively defend special attacks only with positive mitigation and enough remaining energy for heavy. Otherwise prefer surviving heavy, charge, attack, then surviving defense. Emergency saving defense precedes the resource plan; unaffordable saving defense falls back to charge. If no action survives, maximize resulting HP, damage, energy in that order.",
});
export type AdaptiveVersion = keyof typeof ADAPTIVE_DEFINITIONS;
export interface CandidateEvidence {
  readonly action: ActionId; readonly hpAfter: number; readonly energyAfter: number;
  readonly playerDamage: number; readonly survives: boolean; readonly victory: boolean;
}
export interface PolicyEvidence {
  readonly consecutiveDefensesBefore: number; readonly defenseCost: number;
  readonly defenseMultiplier: number; readonly defenseReductionAvailable: number;
  readonly defenseDamagePreventable: number; readonly defenseHpAfter: number;
  readonly defenseAffordable: boolean; readonly candidates: readonly CandidateEvidence[];
  readonly reason: string;
}
export function assessR2Actions(state: R2State, config: DefenseMechanism): Omit<PolicyEvidence, "reason"> {
  validateMechanism(config);
  if (!Number.isSafeInteger(state.consecutiveDefenses) || state.consecutiveDefenses < 0) throw new TypeError("Invalid defense streak");
  const battle = state.battle, intent = getEnemyIntent(battle);
  const multipliers = config.defenseReductionMultipliers;
  const defenseMultiplier = multipliers[Math.min(state.consecutiveDefenses, multipliers.length - 1)];
  const defenseReductionAvailable = (config.defenseReduction + battle.player.upgrades.armor * GAME_CONFIG.upgrades.armor.reduction) * defenseMultiplier;
  const defenseDamagePreventable = Math.min(intent?.damage ?? 0, defenseReductionAvailable);
  const candidates: CandidateEvidence[] = [];
  for (const action of ["attack", "heavy", "charge", "defend"] as const) {
    if (action === "defend" && battle.player.energy < config.defenseCost) continue;
    const step = performAction(battle, action);
    if (!step.accepted) continue;
    const hpAfter = action === "defend" ? battle.player.hp - Math.max(0, (step.effects.enemyIntent?.damage ?? 0) - defenseReductionAvailable) : step.state.player.hp;
    const energyAfter = action === "defend" ? Math.min(battle.player.energyCap, battle.player.energy - config.defenseCost + config.defenseGain) : step.state.player.energy;
    candidates.push({ action, hpAfter, energyAfter, playerDamage: step.effects.playerDamage,
      survives: step.state.phase === "victory" || hpAfter > 0, victory: step.state.phase === "victory" });
  }
  return { consecutiveDefensesBefore: state.consecutiveDefenses, defenseCost: config.defenseCost,
    defenseMultiplier, defenseReductionAvailable, defenseDamagePreventable,
    defenseHpAfter: battle.player.hp - Math.max(0, (intent?.damage ?? 0) - defenseReductionAvailable),
    defenseAffordable: battle.player.energy >= config.defenseCost, candidates };
}
export function chooseAdaptiveAction(state: R2State, version: AdaptiveVersion, config: DefenseMechanism): {
  decision: R2Decision; evidence: PolicyEvidence;
} {
  if (!Object.hasOwn(ADAPTIVE_DEFINITIONS, version)) throw new TypeError("Invalid adaptive strategy version");
  const assessment = assessR2Actions(state, config), candidates = assessment.candidates;
  if (!candidates.length) throw new TypeError("Adaptive strategy requires an ongoing battle");
  const by = (action: ActionId) => candidates.find(x => x.action === action);
  const finish = (action: ActionId, reason: string, originalIntent: ActionId = action) => ({
    decision: { strategyVersion: version, originalIntent, action,
      fallbackReason: originalIntent === "defend" && action !== "defend" ? "defense-insufficient-energy" as const : null },
    evidence: { ...assessment, reason },
  });
  for (const action of ["attack", "heavy"] as const) if (by(action)?.victory) return finish(action, "immediate-kill");
  const baseline = by("heavy") ?? by("attack")!;
  const usefulDefense = assessment.defenseDamagePreventable > 0 && assessment.defenseHpAfter > 0;
  // Evaluate a saving defense before affordability so an energy fallback is explicit evidence.
  if (!baseline.survives && usefulDefense) return assessment.defenseAffordable
    ? finish("defend", "saving-defense") : finish("charge", "saving-defense-unaffordable", "defend");
  if (version === "R2-adaptive-D-v1") return finish(baseline.action, usefulDefense ? "baseline-safe" : "decayed-defense-cannot-save");
  if (state.battle.player.energy < GAME_CONFIG.actions.heavy.cost && by("charge")?.survives) return finish("charge", "restore-heavy-energy");
  const defense = by("defend");
  if (getEnemyIntent(state.battle)?.kind === "special" && defense?.survives && usefulDefense
    && defense.energyAfter >= GAME_CONFIG.actions.heavy.cost) return finish("defend", "special-defense-preserves-heavy");
  for (const action of ["heavy", "charge", "attack", "defend"] as const) {
    if (by(action)?.survives && (action !== "defend" || usefulDefense)) return finish(action, "surviving-resource-plan");
  }
  const best = [...candidates].sort((a, b) => b.hpAfter - a.hpAfter || b.playerDamage - a.playerDamage || b.energyAfter - a.energyAfter)[0];
  return finish(best.action, "unavoidable-defeat-best-endpoint");
}
