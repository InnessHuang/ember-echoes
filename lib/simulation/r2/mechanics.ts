import { GAME_CONFIG } from "../../../data/game-config";
import { performAction } from "../../game/engine";
import type { ActionId, ActionResult, BattleState } from "../../game/types";
import { validateMechanism, type DefenseMechanism } from "./config";

export interface R2State { readonly battle: BattleState; readonly consecutiveDefenses: number }
export interface DefenseEffects {
  readonly multiplier: number; readonly reductionAvailable: number; readonly damagePrevented: number;
  readonly energySpent: number; readonly energyGained: number;
}
export interface R2ActionResult {
  readonly state: R2State; readonly result: ActionResult; readonly defense: DefenseEffects | null;
}
/** Delegate all base transitions; replace only defend HP/energy. No shared config mutation. */
export function performR2Action(state: R2State, action: ActionId, config: DefenseMechanism): R2ActionResult {
  validateMechanism(config);
  if (!Number.isSafeInteger(state.consecutiveDefenses) || state.consecutiveDefenses < 0) throw new TypeError("Invalid defense streak");
  const battle = state.battle;
  if (battle.phase === "ongoing" && action === "defend" && battle.player.energy < config.defenseCost) {
    return { state, result: { accepted: false, state: battle, reason: "insufficient-energy" }, defense: null };
  }
  const original = performAction(battle, action);
  if (!original.accepted) return { state, result: original, defense: null };
  if (action !== "defend") return { state: { battle: original.state, consecutiveDefenses: 0 }, result: original, defense: null };
  const streak = state.consecutiveDefenses + 1;
  const multipliers = config.defenseReductionMultipliers;
  const multiplier = multipliers[Math.min(streak - 1, multipliers.length - 1)];
  // Fractional damage is retained exactly; no implicit rounding of the factor.
  const reductionAvailable = (config.defenseReduction + battle.player.upgrades.armor * GAME_CONFIG.upgrades.armor.reduction) * multiplier;
  const intent = original.effects.enemyIntent;
  const damageTaken = intent === null ? 0 : Math.max(0, intent.damage - reductionAvailable);
  const hp = battle.player.hp - damageTaken;
  const energy = Math.min(battle.player.energyCap, battle.player.energy - config.defenseCost + config.defenseGain);
  const next: BattleState = { ...original.state,
    player: { ...original.state.player, hp, energy },
    phase: original.state.enemy.hp <= 0 ? "victory" : hp <= 0 ? "defeat" : "ongoing" };
  const result: ActionResult = { accepted: true, state: next, effects: { ...original.effects, damageTaken } };
  return { state: { battle: next, consecutiveDefenses: streak }, result,
    defense: { multiplier, reductionAvailable, damagePrevented: intent === null ? 0 : intent.damage - damageTaken,
      energySpent: config.defenseCost, energyGained: energy - (battle.player.energy - config.defenseCost) } };
}
