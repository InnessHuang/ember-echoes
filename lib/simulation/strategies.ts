import { GAME_CONFIG } from "../../data/game-config";
import type { Strategy, StrategyId } from "./types";

const heavyOrAttack: Strategy = state =>
  state.player.energy >= GAME_CONFIG.actions.heavy.cost ? "heavy" : "attack";

/** Policies only choose actions. Combat is always resolved by the existing engine. */
export const STRATEGIES: Readonly<Record<StrategyId, Strategy>> = Object.freeze({
  A: () => "attack",
  B: heavyOrAttack,
  C: state => state.player.energy < state.player.energyCap ? "charge" : "heavy",
  D: (state, intent) => {
    const reduction = GAME_CONFIG.actions.defend.reduction
      + state.player.upgrades.armor * GAME_CONFIG.upgrades.armor.reduction;
    if (intent !== null && state.player.hp - intent.damage <= 0
      && state.player.hp - Math.max(0, intent.damage - reduction) > 0) return "defend";
    return heavyOrAttack(state, intent);
  },
  E: (state, intent) => {
    if (state.player.energy < GAME_CONFIG.actions.heavy.cost && intent !== null) return "defend";
    return heavyOrAttack(state, intent);
  },
  F: (state, intent) => {
    // Policy-only lethal check, matching the accepted blade formula. The engine resolves the action.
    const bladeBonus = state.player.upgrades.blade * GAME_CONFIG.upgrades.blade.damage;
    if (state.enemy.hp <= GAME_CONFIG.actions.attack.damage + bladeBonus) return "attack";
    if (state.player.energy >= GAME_CONFIG.actions.heavy.cost
      && state.enemy.hp <= GAME_CONFIG.actions.heavy.damage + bladeBonus) return "heavy";
    return heavyOrAttack(state, intent);
  },
} satisfies Record<StrategyId, Strategy>);
