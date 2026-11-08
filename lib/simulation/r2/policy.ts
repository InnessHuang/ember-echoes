import type { StrategyId } from "../types";
import type { DefenseMechanism } from "./config";
import type { R2State } from "./mechanics";
import { chooseR2Action } from "./strategies";
import { ADAPTIVE_DEFINITIONS, assessR2Actions, chooseAdaptiveAction, type AdaptiveVersion } from "./adaptive-strategies";

export type R2PolicyVersion = `R2-compat-${StrategyId}-v1` | AdaptiveVersion;
export function validatePolicy(strategyId: StrategyId, version?: R2PolicyVersion): void {
  if (version === undefined || version === `R2-compat-${strategyId}-v1`) return;
  if (Object.hasOwn(ADAPTIVE_DEFINITIONS, version) && version === `R2-adaptive-${strategyId}-v1`) return;
  throw new TypeError("R2 policy version must match source strategy ID");
}
export function chooseR2Policy(state: R2State, strategyId: StrategyId, config: DefenseMechanism, version?: R2PolicyVersion) {
  validatePolicy(strategyId, version);
  if (version && Object.hasOwn(ADAPTIVE_DEFINITIONS, version)) return chooseAdaptiveAction(state, version as AdaptiveVersion, config);
  const decision = chooseR2Action(state, strategyId, config);
  return { decision, evidence: { ...assessR2Actions(state, config), reason: "historical-compatibility-rule" } };
}
