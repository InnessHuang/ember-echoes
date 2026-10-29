import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const temporary = mkdtempSync(path.join(tmpdir(), "ember-boss-resource-"));
const require = createRequire(import.meta.url);
try {
  execFileSync(process.execPath, [require.resolve("typescript/bin/tsc"),
    "--target", "ES2022", "--module", "commonjs", "--strict", "--skipLibCheck",
    "--rootDir", root, "--outDir", temporary, "lib/simulation/run-boss-resource-comparison.ts",
  ], { cwd: root, stdio: "inherit" });
  const { createBossResourceExperiment, bossResourceCsv } = require(path.join(temporary, "lib/simulation/run-boss-resource-comparison.js"));
  const experiment = createBossResourceExperiment();
  const directory = path.join(root, "data/simulation");
  mkdirSync(directory, { recursive: true });
  // These fixed output paths never target the 04A or 04B artifacts.
  writeFileSync(path.join(directory, "boss-resource-comparison-results.csv"), bossResourceCsv(experiment.simulations));
  writeFileSync(path.join(directory, "boss-resource-comparison-actions.json"), JSON.stringify(experiment, null, 2) + "\n");
  console.table(experiment.simulations.map(({ summary }) => summary));
  if (experiment.simulations.some(({ summary }) => summary.outcome === "error")) process.exitCode = 1;
} finally {
  rmSync(temporary, { recursive: true, force: true });
}
