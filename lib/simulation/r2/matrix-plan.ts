import { R2_GROUPS } from "./config";
import type { StrategyId } from "../types";
import type { R2PolicyVersion } from "./policy";

/** Design metadata only. Importing this module never executes a challenge. */
const versions: readonly (readonly [StrategyId, R2PolicyVersion])[] = Object.freeze([
  ["A", "R2-compat-A-v1"], ["B", "R2-compat-B-v1"], ["C", "R2-compat-C-v1"],
  ["D", "R2-compat-D-v1"], ["E", "R2-compat-E-v1"], ["F", "R2-compat-F-v1"],
  ["D", "R2-adaptive-D-v1"], ["E", "R2-adaptive-E-v1"],
]);
export const R2_MATRIX_PLAN = Object.freeze(R2_GROUPS.flatMap(mechanism =>
  (["blade", "core", "armor"] as const).flatMap(first => (["blade", "core", "armor"] as const).flatMap(second =>
    versions.map(([strategyId, policyVersion]) => Object.freeze({
      scenarioId: `${mechanism.id}__${first}-${second}__${policyVersion}`,
      mechanismId: mechanism.id, strategyId, policyVersion,
      upgradePath: Object.freeze([first, second] as const), maxActionsPerBattle: 200,
    }))))));
