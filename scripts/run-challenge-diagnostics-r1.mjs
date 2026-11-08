import { createRequire } from "node:module";
import { createHash, randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import * as fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const require = createRequire(import.meta.url);
const modules = new Map();
const generatorHashAtLoad = createHash("sha256").update(fs.readFileSync(fileURLToPath(import.meta.url))).digest("hex");
/** Runtime tooling only: transpile trusted project TS in memory; importing never runs the matrix. */
function loadTs(file) {
  file = path.resolve(root, file.endsWith(".ts") ? file : file + ".ts");
  if (modules.has(file)) return modules.get(file).exports;
  const unit = { exports: {} }; modules.set(file, unit);
  const ts = require("typescript");
  const text = fs.readFileSync(file, "utf8");
  unit.sourceHash = createHash("sha256").update(text).digest("hex");
  const source = ts.transpileModule(text, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true },
  }).outputText;
  const localRequire = name => name.startsWith(".") ? loadTs(path.resolve(path.dirname(file), name)) : require(name);
  new Function("require", "module", "exports", source)(localRequire, unit, unit.exports);
  return unit.exports;
}
export function getValidationApi() {
  const api = loadTs("lib/simulation/serialize-challenge-diagnostics-r1.ts");
  for (const [file, current] of Object.entries(api.implementationFingerprint(root))) {
    const loaded = file === "scripts/run-challenge-diagnostics-r1.mjs" ? generatorHashAtLoad : modules.get(path.resolve(root, file))?.sourceHash;
    if (current !== loaded) throw new Error(`Implementation changed after loading: ${file}`);
  }
  return api;
}
export const OUTPUT_NAMES = Object.freeze(["results.csv", "actions.json"]);
export function assertOutputDirectory(projectRoot, io = fs) {
  const directory = path.join(projectRoot, "data/simulation");
  if (io.realpathSync(directory) !== path.resolve(directory) || !io.lstatSync(directory).isDirectory()) throw new Error("Refusing symlinked or invalid output directory");
  return directory;
}
function readRegular(file, io) {
  if (!io.lstatSync(file).isFile()) throw new Error(`Expected regular file: ${file}`);
  return io.readFileSync(file);
}
function fileRecord(directory, name, io) {
  const bytes = readRegular(path.join(directory, name), io);
  return { name, sha256: createHash("sha256").update(bytes).digest("hex"), size: bytes.length };
}
function header(data) {
  return { schemaVersion: 1, status: "committed", reconstructionId: data.reconstruction.id,
    baselineCommit: data.baselineCommit, coverage: data.coverage, maxActionsPerBattle: data.maxActionsPerBattle,
    implementation: data.implementation, config: data.config, strategyDefinitions: data.strategyDefinitions,
    experimentSummary: data.experimentSummary };
}
function verifyData(directory, io) {
  const json = readRegular(path.join(directory, "actions.json"), io);
  const data = JSON.parse(json.toString("utf8"));
  const { csv } = getValidationApi().validateChallengeExperiment(data, root);
  if (!readRegular(path.join(directory, "results.csv"), io).equals(Buffer.from(csv, "utf8"))) throw new Error("CSV does not match independently validated JSON");
  return data;
}
/** A committed marker plus byte integrity AND independent semantic replay are mandatory.
 * This verifies current content; it does not promise power-loss durability or authenticity.
 */
export function verifyR1Run(directory, io = fs) {
  if (io.realpathSync(directory) !== path.resolve(directory) || !io.lstatSync(directory).isDirectory()) throw new Error("Invalid run directory");
  let failed = false;
  try { io.lstatSync(path.join(directory, "failure.json")); failed = true; }
  catch (error) { if (error.code !== "ENOENT") throw error; }
  if (failed) throw new Error("Incomplete run: failure marker exists");
  const manifest = JSON.parse(readRegular(path.join(directory, "manifest.json"), io).toString("utf8"));
  if (manifest?.schemaVersion !== 1 || manifest.status !== "committed" || !Array.isArray(manifest.files) || manifest.files.length !== 2) throw new Error("Invalid manifest");
  const files = OUTPUT_NAMES.map(name => fileRecord(directory, name, io));
  if (!isDeepStrictEqual(manifest.files, files)) throw new Error("Manifest file size/hash mismatch");
  const data = verifyData(directory, io);
  const expected = JSON.parse(JSON.stringify({ ...header(data), files }));
  if (!isDeepStrictEqual(manifest, expected)) throw new Error("Manifest metadata/fingerprint/summary mismatch");
  return manifest;
}
/** Unique 0700 directory. Before rename: incomplete; successful manifest rename: committed.
 * Never deletes outputs. All post-commit failures are warnings, never failure.json.
 */
export function writeR1Artifacts(projectRoot, csv, json, io = fs, uniqueId = randomUUID) {
  const parent = assertOutputDirectory(projectRoot, io), id = uniqueId();
  if (typeof id !== "string" || !/^[0-9a-f-]{36}$/.test(id)) throw new Error("Invalid unique run ID");
  const candidate = path.join(parent, `challenge-diagnostics-r1-${id}`);
  let owned = null, stage = "create run directory", committed = false, manifestBytes = null;
  const handles = new Set(), warnings = [];
  const writeExclusive = (name, bytes) => {
    const file = path.join(owned.directory, name);
    stage = `open ${name}`;
    const fd = io.openSync(file, "wx", 0o600); handles.add(fd);
    stage = `fstat ${name}`; if (!io.fstatSync(fd).isFile()) throw new Error("Expected regular output file");
    stage = `write ${name}`; io.writeFileSync(fd, bytes);
    stage = `fsync ${name}`; io.fsyncSync(fd);
    stage = `close ${name}`; io.closeSync(fd); handles.delete(fd);
    stage = `verify contents ${name}`;
    if (!readRegular(file, io).equals(bytes)) throw new Error("Content verification failed");
  };
  try {
    io.mkdirSync(candidate, { mode: 0o700 });
    owned = { directory: candidate };
    stage = "validate experiment content";
    const parsed = JSON.parse(json);
    const verified = getValidationApi().validateChallengeExperiment(parsed, root);
    if (csv !== verified.csv) throw new Error("CSV does not match independently validated JSON");
    writeExclusive("results.csv", Buffer.from(csv, "utf8"));
    writeExclusive("actions.json", Buffer.from(json, "utf8"));
    stage = "verify stored data";
    const data = verifyData(owned.directory, io);
    const files = OUTPUT_NAMES.map(name => fileRecord(owned.directory, name, io));
    manifestBytes = Buffer.from(JSON.stringify({ ...header(data), files }, null, 2) + "\n", "utf8");
    writeExclusive("manifest.pending.json", manifestBytes);
    stage = "rename manifest";
    try { io.lstatSync(path.join(owned.directory, "manifest.json")); throw new Error("Manifest already exists"); }
    catch (error) { if (error.code !== "ENOENT") throw error; }
    io.renameSync(path.join(owned.directory, "manifest.pending.json"), path.join(owned.directory, "manifest.json"));
    committed = true; // Logical commit point; do not turn post-commit durability failures into incomplete.
  } catch (cause) {
    // Covers a lost acknowledgement from an injected/ambiguous rename: if the exact
    // intended marker is published and the entire asset validates, it is committed.
    if (owned && stage === "rename manifest" && manifestBytes) {
      let possibleCommit = false;
      try {
        io.lstatSync(path.join(owned.directory, "manifest.json"));
        possibleCommit = true;
        if (readRegular(path.join(owned.directory, "manifest.json"), io).equals(manifestBytes)) {
          verifyR1Run(owned.directory, io); committed = true;
          warnings.push(`Rename acknowledgement failed but committed content verified: ${String(cause)}`);
        }
      } catch (error) { if (error.code !== "ENOENT") possibleCommit = true; }
      if (possibleCommit && !committed) {
        // Do not fabricate an incomplete marker when publication may already have
        // occurred but I/O prevents deciding. A later independent read must resolve it.
        return { state: "indeterminate", directory: owned.directory,
          durabilityWarnings: [`Rename outcome cannot be verified: ${String(cause)}`] };
      }
    }
    if (!committed) {
      const errors = [];
      for (const fd of handles) { try { io.closeSync(fd); } catch (error) { errors.push(String(error)); } }
      const record = { schemaVersion: 1, status: "incomplete", stage, error: cause instanceof Error ? cause.message : String(cause) };
      if (owned) {
        try { io.writeFileSync(path.join(owned.directory, "failure.json"), JSON.stringify(record, null, 2) + "\n", { flag: "wx", mode: 0o600 }); }
        catch (error) { errors.push(`Failure marker could not be written: ${String(error)}`); }
      }
      const error = new Error(`R1 run incomplete at ${stage}; directory=${owned?.directory ?? "not created"}: ${record.error}${errors.length ? "; " + errors.join("; ") : ""}`, { cause });
      error.runDirectory = owned?.directory ?? null; error.stage = stage; error.state = "incomplete";
      throw error;
    }
  }
  for (const directory of [owned.directory, parent]) {
    let fd;
    try { fd = io.openSync(directory, "r"); io.fsyncSync(fd); }
    catch (error) { warnings.push(`Directory durability not confirmed (${directory}): ${String(error)}`); }
    finally { if (fd !== undefined) { try { io.closeSync(fd); } catch (error) { warnings.push(`Directory close failed: ${String(error)}`); } } }
  }
  if (warnings.length) {
    try { io.writeFileSync(path.join(owned.directory, "durability-warning.json"), JSON.stringify({ state: "committed", warnings }, null, 2) + "\n", { flag: "wx", mode: 0o600 }); }
    catch (error) { warnings.push(`Warning record could not be written: ${String(error)}`); }
  }
  return { state: "committed", directory: owned.directory, durabilityWarnings: warnings };
}
export function main() {
  assertOutputDirectory(root);
  const { CHALLENGE_SCENARIOS, runChallengeDiagnostics } = loadTs("lib/simulation/run-challenge-diagnostics-r1.ts");
  const api = getValidationApi();
  const results = CHALLENGE_SCENARIOS.map(scenario => runChallengeDiagnostics(scenario));
  const json = api.challengeDiagnosticsJson(results, "full", root), csv = api.challengeDiagnosticsCsv(results);
  const outcome = writeR1Artifacts(root, csv, json);
  if (outcome.state !== "committed") throw new Error(`R1 commit state is indeterminate: ${outcome.directory}`);
  verifyR1Run(outcome.directory);
  console.log(`Committed, semantically verified R1 asset: ${outcome.directory}`);
  for (const warning of outcome.durabilityWarnings) console.warn(warning);
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(); }
  catch (error) { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; }
}
