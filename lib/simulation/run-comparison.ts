import { runSimulation } from "./run-simulation";
import type { Scenario, SimulationResult } from "./types";

/** Task 04B matrix; the original A/B/C/D baseline remains separate and unchanged. */
export const COMPARISON_SCENARIOS: readonly Scenario[] = Object.freeze(
  (["light", "heavy", "boss"] as const).flatMap(enemyId =>
    (["B", "D", "E", "F"] as const).map(strategyId => Object.freeze({ enemyId, strategyId }))),
);

export function runComparison(): SimulationResult[] {
  return COMPARISON_SCENARIOS.map(scenario => runSimulation(scenario));
}
