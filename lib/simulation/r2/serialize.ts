import { GAME_CONFIG } from "../../../data/game-config";
import type { R2Run } from "./runner";
import { R2_STRATEGY_DEFINITION } from "./strategies";
import { assertR2Json, verifyR2Run } from "./verify";
import { ADAPTIVE_DEFINITIONS } from "./adaptive-strategies";

/** In-memory only: no filesystem writer, publication marker or full experiment runner. */
export function serializeR2Run(run: R2Run): string {
  verifyR2Run(run);
  if (run.outcome === "error") throw new TypeError("Failed runs require explicit diagnostic serialization");
  const envelope = { schemaVersion: 1, experiment: "Task 06C-1 R2 framework sample",
    task05Baseline: "e3f0a3ff04506e6cbb7f2736f50ca710d7687cc7",
    r1ReconstructionCommit: "25807d045f6e49dfc1d15b5667cf4aa372545d89",
    analysisBaseline: "5ae511f287cd222ec3d995eb0749e00a69982d4d",
    config: GAME_CONFIG, strategyDefinition: R2_STRATEGY_DEFINITION, adaptiveDefinitions: ADAPTIVE_DEFINITIONS, result: run };
  assertR2Json(envelope);
  return JSON.stringify(envelope, null, 2) + "\n";
}
/** Failure evidence only; never a completion asset. Refuses non-JSON raw evidence. */
export function serializeR2Error(run: R2Run): string {
  if (run.outcome !== "error") throw new TypeError("Expected a failed R2 run");
  verifyR2Run(run);
  const envelope = { schemaVersion: 1, status: "failed", experiment: "R2 diagnostic evidence", result: run };
  // Validate the original object graph before JSON.stringify can invoke user-defined hooks.
  assertR2Json(envelope);
  return JSON.stringify(envelope, null, 2) + "\n";
}
