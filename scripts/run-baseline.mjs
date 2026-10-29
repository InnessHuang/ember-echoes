import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Compile using the project's existing TypeScript; no loaders or new dependencies.
const root = fileURLToPath(new URL("../", import.meta.url));
const temporary = mkdtempSync(path.join(tmpdir(), "ember-baseline-"));
const require = createRequire(import.meta.url);
try {
  execFileSync(process.execPath, [require.resolve("typescript/bin/tsc"),
    "--target", "ES2022", "--module", "commonjs", "--strict", "--skipLibCheck",
    "--rootDir", root, "--outDir", temporary, "lib/simulation/run-simulation.ts",
  ], { cwd: root, stdio: "inherit" });
  const { runBaseline, MAX_ACTIONS } = require(path.join(temporary, "lib/simulation/run-simulation.js"));
  const { GAME_CONFIG } = require(path.join(temporary, "data/game-config.js"));
  const simulations = runBaseline();
  const directory = path.join(root, "data/simulation");
  mkdirSync(directory, { recursive: true });
  const columns = Object.keys(simulations[0].summary);
  const csvCell = value => value == null ? "" : `"${String(value).replaceAll('"', '""')}"`;
  const csv = [columns.join(","), ...simulations.map(({ summary }) => columns.map(key => csvCell(summary[key])).join(","))].join("\n") + "\n";
  writeFileSync(path.join(directory, "baseline-results.csv"), csv);
  writeFileSync(path.join(directory, "baseline-actions.json"), JSON.stringify({
    schemaVersion: 1,
    engineBaseCommit: "8fc910d75ba42387ab34dbcde7df35df0e8c581d",
    maxActions: MAX_ACTIONS,
    damageAccounting: "Effective loss = max(0, HP before) - max(0, HP after); raw HP deltas and signed final HP are also retained.",
    config: GAME_CONFIG,
    simulations,
  }, null, 2) + "\n");
  console.table(simulations.map(({ summary }) => summary));
  if (simulations.some(({ summary }) => summary.outcome === "error")) process.exitCode = 1;
} finally {
  rmSync(temporary, { recursive: true, force: true });
}
