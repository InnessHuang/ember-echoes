import { getEnemyIntent } from "../../game/engine";
import type { ActionId } from "../../game/types";
import { STRATEGIES } from "../strategies";
import type { StrategyId } from "../types";
import type { DefenseMechanism } from "./config";
import type { R2State } from "./mechanics";

export const R2_STRATEGY_DEFINITION = "compat-v1: original A–F intent, including historical D risk thresholds; unaffordable defend falls back to charge. Not decay-aware or R2-optimized.";
export interface R2Decision {
  readonly strategyVersion: string; readonly originalIntent: ActionId; readonly action: ActionId;
  readonly fallbackReason: "defense-insufficient-energy" | null;
}
export function chooseR2Action(state: R2State, strategyId: StrategyId, config: DefenseMechanism): R2Decision {
  if (!Object.hasOwn(STRATEGIES, strategyId)) throw new TypeError("Invalid R2 source strategy ID");
  const originalIntent = STRATEGIES[strategyId](state.battle, getEnemyIntent(state.battle));
  const fallback = originalIntent === "defend" && state.battle.player.energy < config.defenseCost;
  return { strategyVersion: `R2-compat-${strategyId}-v1`, originalIntent,
    action: fallback ? "charge" : originalIntent, fallbackReason: fallback ? "defense-insufficient-energy" : null };
}
