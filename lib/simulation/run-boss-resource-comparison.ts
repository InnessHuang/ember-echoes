import { GAME_CONFIG } from "../../data/game-config";
import type { BattlePhase } from "../game/types";
import { MAX_ACTIONS, runSimulation } from "./run-simulation";
import type { Scenario, SimulationResult, SimulationSummary } from "./types";

export const BOSS_RESOURCE_SCENARIOS: readonly Scenario[] = Object.freeze([
  Object.freeze({ enemyId: "boss", strategyId: "E" } as const),
  Object.freeze({ enemyId: "boss", strategyId: "C" } as const),
]);
export const RESOURCE_STRATEGY_MAPPING = Object.freeze({ E: "E", G: "C" } as const);
export interface BossResourceResult extends Omit<SimulationResult, "summary"> {
  readonly summary: SimulationSummary & {
    readonly strategyLabel: string;
    readonly finalPhase: BattlePhase;
    readonly overkillDamageDealt: number;
    readonly overkillDamageTaken: number;
  };
}

/** Experiment adapter only: reuse the original policy registry, runner and accounting. */
export function runBossResourceComparison(): BossResourceResult[] {
  return BOSS_RESOURCE_SCENARIOS.map(scenario => {
    const run = runSimulation(scenario);
    return {
      ...run,
      summary: {
        ...run.summary,
        strategyLabel: scenario.strategyId === "C" ? "G (implemented by C)" : "E",
        finalPhase: run.finalState.phase,
        overkillDamageDealt: run.summary.rawHpLossDealt - run.summary.totalDamageDealt,
        overkillDamageTaken: run.summary.rawHpLossTaken - run.summary.totalDamageTaken,
      },
    };
  });
}

export function createBossResourceExperiment() {
  return {
    schemaVersion: 1,
    experiment: "Task 04C-1: Boss resource acquisition E vs G (implemented by C)",
    engineBaseCommit: "431a324c9797b95060bf2677f71838bbbfe5b2a0",
    strategyMapping: RESOURCE_STRATEGY_MAPPING,
    maxActions: MAX_ACTIONS,
    config: GAME_CONFIG,
    damageAccounting: "Effective loss = max(0, HP before) - max(0, HP after); raw HP loss retains negative HP; overkill = raw loss - effective loss.",
    simulations: runBossResourceComparison(),
  };
}

export function bossResourceCsv(results: readonly BossResourceResult[]): string {
  const columns = Object.keys(results[0].summary) as (keyof BossResourceResult["summary"])[];
  const cell = (value: unknown) => value == null ? "" : `"${String(value).replaceAll('"', '""')}"`;
  return [columns.join(","), ...results.map(({ summary }) => columns.map(key => cell(summary[key])).join(","))].join("\n") + "\n";
}
