import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { verifyChallengeTrace } from "./verify-challenge-diagnostics-r1";
import { GAME_CONFIG } from "../../data/game-config";
import { CHALLENGE_SCENARIOS, UPGRADE_PATHS, type ChallengeDiagnostics, type ChallengeScenario } from "./run-challenge-diagnostics-r1";
import { MAX_ACTIONS } from "./run-simulation";

export const BASELINE_COMMIT = "e3f0a3ff04506e6cbb7f2736f50ca710d7687cc7";
export const STRATEGY_DEFINITIONS = Object.freeze({
  A: "Always attack.",
  B: "Heavy when energy >= heavy cost; otherwise attack.",
  C: "Charge when energy < current energyCap; otherwise heavy.",
  D: "Defend only when the announced attack is lethal and defense leaves HP > 0; otherwise B. Armor is included; no player-first-kill prediction.",
  E: "Defend when energy < heavy cost and intent is non-null; otherwise B.",
  F: "Attack if lethal (including Blade); else affordable heavy if lethal (including Blade); otherwise B.",
});
export const METRIC_DEFINITIONS = Object.freeze({
  playerActions: "Accepted player actions; upgrades excluded. Accepted invalid outputs remain counted but are excluded from validated damage totals.",
  actionAttempts: "All attempted actions, including rejected actions and exceptions.",
  enemyAttacks: "Sum of per-action enemyAttacksExecuted deltas; announced but unexecuted intents excluded.",
  effectiveLoss: "max(0, beforeHP) - max(0, afterHP), summed within battles.",
  rawLoss: "beforeHP - afterHP, summed within battles; negative final HP retained.",
  overkillLoss: "rawLoss - effectiveLoss.",
  startedBattles: "All actually started battles, including a final defeat, timeout or error.",
  completedBattles: "Battles won, not merely ended.",
  timeout: "After execution.maxActionsPerBattle accepted actions in one battle, only if still ongoing. A terminal final allowed action retains victory/defeat. Full mode requires 200.",
  absentBattle: "CSV fields for unstarted battles, including finalBossHp, are empty; JSON keeps only actually started battles.",
  finalChallengeState: "Controller phase and final validated battle, without the opaque Symbol identity; diagnostic outcome is recorded separately.",
});

export function scenarioId(scenario: ChallengeScenario): string {
  return `${scenario.upgradePath.join("-")}__${scenario.strategyId}`;
}
function invalid(path: string, detail: string): never { throw new TypeError(`Invalid diagnostics at ${path}: ${detail}`); }
function object(value: unknown, path: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) invalid(path, "expected object");
  return value as Record<string, unknown>;
}
function array(value: unknown, path: string): unknown[] {
  if (!Array.isArray(value)) invalid(path, "expected array");
  return value;
}
function number(value: unknown, path: string, count = false): void {
  if (typeof value !== "number" || !Number.isFinite(value) || (count && (!Number.isInteger(value) || value < 0))) invalid(path, "expected finite number" + (count ? " / nonnegative integer" : ""));
}
function member(value: unknown, allowed: readonly unknown[], path: string): void {
  if (!allowed.includes(value)) invalid(path, "unexpected or missing value");
}
function nullableText(value: unknown, path: string): void {
  if (value !== null && typeof value !== "string") invalid(path, "expected string or null");
}
/** Reject values JSON.stringify would silently drop or coerce; canonicalize without mutating inputs.
 * Repeated shared references are fine; ancestor cycles, getters, symbols and sparse slots are not.
 */
function canonical(value: unknown, path = "$", ancestors = new Set<object>()): unknown {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") { number(value, path); return value; }
  if (typeof value !== "object") invalid(path, "not a JSON value");
  if (ancestors.has(value)) invalid(path, "circular reference");
  const proto = Object.getPrototypeOf(value);
  if (!Array.isArray(value) && proto !== Object.prototype && proto !== null) invalid(path, "expected plain object");
  ancestors.add(value);
  const keys = Reflect.ownKeys(value);
  if (keys.some(k => typeof k === "symbol")) invalid(path, "Symbol key");
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key)!;
    if (!Object.hasOwn(descriptor, "value")) invalid(path, "accessor property");
  }
  let result: unknown;
  if (Array.isArray(value)) {
    if (keys.length !== value.length + 1) invalid(path, "sparse array or extra array properties");
    result = Array.from({ length: value.length }, (_, i) => {
      if (!Object.hasOwn(value, i)) invalid(path, "sparse array");
      return canonical(value[i], `${path}[${i}]`, ancestors);
    });
  } else {
    const out: Record<string, unknown> = Object.create(null);
    for (const key of (keys as string[]).sort()) {
      if (!Object.prototype.propertyIsEnumerable.call(value, key)) invalid(path, "non-enumerable property");
      out[key] = canonical((value as Record<string, unknown>)[key], `${path}.${key}`, ancestors);
    }
    result = out;
  }
  ancestors.delete(value);
  return result;
}
function state(value: unknown, path: string): void {
  const s = object(value, path), p = object(s.player, `${path}.player`), e = object(s.enemy, `${path}.enemy`);
  for (const key of ["hp", "energy", "energyCap"]) number(p[key], `${path}.player.${key}`);
  const u = object(p.upgrades, `${path}.player.upgrades`);
  for (const key of ["blade", "core", "armor"]) number(u[key], `${path}.player.upgrades.${key}`, true);
  number(e.hp, `${path}.enemy.hp`); member(e.id, ["light", "heavy", "boss"], `${path}.enemy.id`);
  number(s.turn, `${path}.turn`, true); number(s.enemyAttacksExecuted, `${path}.enemyAttacksExecuted`, true);
  member(s.phase, ["ongoing", "victory", "defeat"], `${path}.phase`);
}
function same(a: unknown, b: unknown, path: string): void {
  if (JSON.stringify(canonical(a)) !== JSON.stringify(canonical(b))) invalid(path, "state/summary mismatch");
}
function intent(value: unknown, path: string): void {
  if (value === null) return;
  const i = object(value, path); member(i.kind, ["normal", "special"], `${path}.kind`);
  number(i.damage, `${path}.damage`); number(i.attackNumber, `${path}.attackNumber`, true);
}
const counters = ["actionAttempts", "playerActions", "enemyAttacks", "attackCount", "heavyCount", "defendCount", "chargeCount", "bossNormalAttacks", "bossSpecialAttacks"] as const;
const damages = ["totalDamageTaken", "totalDamageDealt", "rawHpLossTaken", "rawHpLossDealt"] as const;
function summary(value: unknown, path: string): Record<string, unknown> {
  const s = object(value, path);
  member(s.outcome, ["victory", "defeat", "timeout", "error"], `${path}.outcome`); nullableText(s.reason, `${path}.reason`);
  for (const key of counters) number(s[key], `${path}.${key}`, true);
  for (const key of [...damages, "playerHp", "enemyHp", "finalEnergy"]) number(s[key], `${path}.${key}`);
  return s;
}
/** Structural and accounting validation only: never executes a strategy or a battle. */
function validateRun(value: unknown): asserts value is ChallengeDiagnostics {
  canonical(value);
  const r = object(value, "$"), scenario = object(r.scenario, "scenario");
  const execution = object(r.execution, "execution");
  number(execution.maxActionsPerBattle, "execution.maxActionsPerBattle", true);
  if (Number(execution.maxActionsPerBattle) < 1 || Number(execution.maxActionsPerBattle) > MAX_ACTIONS) invalid("execution.maxActionsPerBattle", "expected 1..200");
  const path = array(scenario.upgradePath, "scenario.upgradePath");
  if (path.length !== 2) invalid("scenario.upgradePath", "expected two upgrades");
  for (const id of path) member(id, ["blade", "core", "armor"], "scenario.upgradePath");
  member(scenario.strategyId, Object.keys(STRATEGY_DEFINITIONS), "scenario.strategyId");
  const s = summary(r.summary, "summary"), battles = array(r.battles, "battles"), upgrades = array(r.upgrades, "upgrades");
  number(s.startedBattles, "summary.startedBattles", true); number(s.completedBattles, "summary.completedBattles", true);
  number(s.overkillDamageTaken, "summary.overkillDamageTaken"); number(s.overkillDamageDealt, "summary.overkillDamageDealt");
  if (battles.length < 1 || battles.length > 3 || s.startedBattles !== battles.length || upgrades.length !== battles.length - 1) invalid("battles", "inconsistent battle/upgrade count");
  let wins = 0;
  const totals: Record<string, number> = {};
  for (const [index, value] of battles.entries()) {
    const b = object(value, `battles[${index}]`), bs = summary(b.summary, `battles[${index}].summary`);
    same(b.execution, execution, "battle.execution");
    state(b.initialState, "initialState"); state(b.finalState, "finalState");
    member(bs.enemyId, [["light", "heavy", "boss"][index]], "battle.enemyId");
    member(bs.strategyId, [scenario.strategyId], "battle.strategyId");
    for (const key of ["initialPlayerHp", "initialEnergy", "initialEnergyCap", "initialEnemyHp"]) number(bs[key], key);
    const initial = b.initialState as { player: { hp: number; energy: number; energyCap: number }; enemy: { id: string; hp: number } };
    const final = b.finalState as typeof initial;
    same(initial.enemy.id, bs.enemyId, "battle.initialState.enemy.id");
    same([bs.initialPlayerHp, bs.initialEnergy, bs.initialEnergyCap, bs.initialEnemyHp],
      [initial.player.hp, initial.player.energy, initial.player.energyCap, initial.enemy.hp], "battle.initialSummary");
    same([bs.playerHp, bs.enemyHp, bs.finalEnergy], [final.player.hp, final.enemy.hp, final.player.energy], "battle.finalSummary");
    const actions = array(b.actions, "actions");
    let cursor = b.initialState;
    let accepted = 0, hasError = false;
    for (const [n, value] of actions.entries()) {
      const a = object(value, `actions[${n}]`);
      if (a.attempt !== n + 1) invalid("action.attempt", "expected consecutive attempt index");
      if (a.action !== null && typeof a.action !== "string") invalid("action.action", "expected string or null");
      if (typeof a.accepted !== "boolean") invalid("action.accepted", "expected boolean");
      if (a.accepted) { accepted++; member(a.action, ["attack", "heavy", "defend", "charge"], "action.action"); }
      state(a.before, "action.before"); state(a.after, "action.after"); intent(a.intentBefore, "action.intentBefore"); nullableText(a.error, "action.error");
      same(a.before, cursor, "action.before");
      if (a.accepted && a.error === null) cursor = a.after;
      if (!a.accepted || a.error !== null) hasError = true;
      if (hasError && n !== actions.length - 1) invalid("action.error", "continued after error/rejection");
      if (a.effects !== null) {
        const e = object(a.effects, "action.effects");
        number(e.playerDamage, "effects.playerDamage"); number(e.damageTaken, "effects.damageTaken"); intent(e.enemyIntent, "effects.enemyIntent");
      } else if (a.accepted) invalid("action.effects", "accepted action requires effects");
    }
    same(b.finalState, cursor, "battle.finalState");
    if (bs.actionAttempts !== actions.length || bs.playerActions !== accepted) invalid("actions", "attempt/accepted count mismatch");
    const limit = Number(execution.maxActionsPerBattle);
    if (accepted > limit) invalid("battle.playerActions", "exceeds execution limit");
    const phase = object(b.finalState, "finalState").phase;
    if (hasError !== (bs.outcome === "error")) invalid("battle.outcome", "error/rejection must remain error");
    if (bs.outcome === "timeout" && (accepted !== limit || phase !== "ongoing")) invalid("battle.timeout", "requires exactly the limit of accepted actions and ongoing state");
    if (bs.outcome === "victory" && phase !== "victory") invalid("battle.victory", "requires victory final state");
    if (bs.outcome === "defeat" && phase !== "defeat") invalid("battle.defeat", "requires defeat final state");
    if (bs.outcome === "victory") wins++;
    if (index < battles.length - 1 && bs.outcome !== "victory") invalid("battles", "continued after non-victory");
    for (const key of [...counters, ...damages]) totals[key] = (totals[key] ?? 0) + Number(bs[key]);
  }
  for (const key of [...counters, ...damages]) if (s[key] !== totals[key]) invalid(`summary.${key}`, "does not equal battle totals");
  if (s.completedBattles !== wins || s.overkillDamageTaken !== Number(s.rawHpLossTaken) - Number(s.totalDamageTaken)
    || s.overkillDamageDealt !== Number(s.rawHpLossDealt) - Number(s.totalDamageDealt)) invalid("summary", "inconsistent wins/overkill");
  for (const [index, value] of upgrades.entries()) {
    const u = object(value, "upgrade");
    if (u.encounter !== index || u.upgrade !== path[index]) invalid("upgrade", "does not match planned transition");
    state(u.before, "upgrade.before"); state(u.after, "upgrade.after");
    same(u.before, object(battles[index], "battle").finalState, "upgrade.before");
    same(u.after, object(battles[index + 1], "battle").initialState, "upgrade.after");
  }
  const last = object(battles[battles.length - 1], "lastBattle");
  const final = last.finalState as { player: { hp: number; energy: number }; enemy: { hp: number } };
  same([s.playerHp, s.enemyHp, s.finalEnergy], [final.player.hp, final.enemy.hp, final.player.energy], "summary.finalState");
  const lastOutcome = object(last.summary, "lastSummary").outcome;
  if (s.outcome !== "error" && s.outcome !== lastOutcome) invalid("summary.outcome", "does not match final battle");
  if (s.outcome === "error" && lastOutcome !== "error"
    && !(lastOutcome === "victory" && battles.length < 3 && typeof s.reason === "string" && s.reason.length > 0)) {
    invalid("summary.outcome", "error requires battle error or a failed upgrade transition");
  }
  if (s.outcome === "victory" && wins !== 3) invalid("summary.outcome", "challenge victory requires three wins");
  verifyChallengeTrace(value as ChallengeDiagnostics);
}

export const CSV_COLUMNS = Object.freeze([
  "scenarioId", "strategyId", "upgradePath", "outcome", "reason", "startedBattles", "completedBattles",
  "actionAttempts", "playerActions", "enemyAttacks", "initialPlayerHp", "finalPlayerHp", "finalBossHp",
  "initialEnergy", "finalEnergy", "totalDamageDealt", "totalDamageTaken", "rawHpLossDealt", "rawHpLossTaken",
  "overkillDamageDealt", "overkillDamageTaken", "attackCount", "heavyCount", "defendCount", "chargeCount",
  "bossNormalAttacks", "bossSpecialAttacks",
  "lightInitialPlayerHp", "lightFinalPlayerHp", "lightInitialEnemyHp", "lightFinalEnemyHp",
  "heavyInitialPlayerHp", "heavyFinalPlayerHp", "heavyInitialEnemyHp", "heavyFinalEnemyHp",
  "bossInitialPlayerHp", "bossFinalPlayerHp", "bossInitialEnemyHp", "bossFinalEnemyHp",
] as const);
function row(run: ChallengeDiagnostics): Record<string, unknown> {
  const first = run.battles[0].initialState;
  const out: Record<string, unknown> = { ...run.summary, scenarioId: scenarioId(run.scenario), strategyId: run.scenario.strategyId,
    upgradePath: run.scenario.upgradePath.join("->"), initialPlayerHp: first.player.hp, finalPlayerHp: run.summary.playerHp,
    finalBossHp: run.battles.find(b => b.initialState.enemy.id === "boss")?.finalState.enemy.hp ?? null,
    initialEnergy: first.player.energy, finalEnergy: run.summary.finalEnergy };
  for (const enemy of ["light", "heavy", "boss"]) {
    const b = run.battles.find(b => b.initialState.enemy.id === enemy);
    out[`${enemy}InitialPlayerHp`] = b?.initialState.player.hp ?? null;
    out[`${enemy}FinalPlayerHp`] = b?.finalState.player.hp ?? null;
    out[`${enemy}InitialEnemyHp`] = b?.initialState.enemy.hp ?? null;
    out[`${enemy}FinalEnemyHp`] = b?.finalState.enemy.hp ?? null;
  }
  return out;
}
/** Low-level row serializer: may serialize representative fixtures. Full matrix coverage is checked by createChallengeExperiment. */
export function challengeDiagnosticsCsv(runs: readonly ChallengeDiagnostics[]): string {
  if (!Array.isArray(runs) || runs.length === 0) invalid("runs", "expected nonempty array");
  canonical(runs, "runs");
  const lines = runs.map(run => {
    validateRun(run);
    const values = row(run);
    return CSV_COLUMNS.map(key => values[key] === null ? "" : `"${String(values[key]).replaceAll('"', '""')}"`).join(",");
  });
  return CSV_COLUMNS.join(",") + "\n" + lines.join("\n") + "\n";
}
export function validateScenarioCoverage(scenarios: readonly ChallengeScenario[]): void {
  same(scenarios, CHALLENGE_SCENARIOS, "54 scenarios in fixed matrix order");
}
export function createChallengeExperiment(runs: readonly ChallengeDiagnostics[], coverage: "full" | "representative" = "full", projectRoot = process.cwd()) {
  if (!Array.isArray(runs) || runs.length === 0) invalid("runs", "expected nonempty array");
  canonical(runs, "runs");
  member(coverage, ["full", "representative"], "coverage");
  const maxActionsPerBattle = runs[0].execution.maxActionsPerBattle;
  if (runs.some(run => run.execution.maxActionsPerBattle !== maxActionsPerBattle)) invalid("execution.maxActionsPerBattle", "mixed execution limits");
  if (coverage === "full" && maxActionsPerBattle !== MAX_ACTIONS) invalid("execution.maxActionsPerBattle", "full mode requires 200");
  const ids = runs.map(r => scenarioId(r.scenario));
  if (new Set(ids).size !== ids.length) invalid("runs", "duplicate scenario IDs");
  if (coverage === "full" && (ids.length !== CHALLENGE_SCENARIOS.length || ids.some((id, i) => id !== scenarioId(CHALLENGE_SCENARIOS[i])))) invalid("runs", "expected all 54 scenarios in matrix order");
  if (coverage === "full") validateScenarioCoverage(runs.map(run => run.scenario));
  runs.forEach(validateRun);
  const results = runs.map(run => {
    const last = run.battles.at(-1)!;
    const phase = last.finalState.phase === "defeat" ? "defeat" : last.finalState.phase === "victory"
      ? run.battles.length === 3 ? "victory" : "upgrade" : "battle";
    return { ...run, scenarioId: scenarioId(run.scenario), finalChallengeState: {
      encounter: run.battles.length - 1, phase, battle: last.finalState,
    } };
  });
  // Canonical copy isolates all nested metadata and results from caller-owned objects.
  return canonical({ schemaVersion: 1, reconstruction: { id: "Task 06A-R1", originalCommitRecovered: false },
    baselineCommit: BASELINE_COMMIT, coverage, maxActionsPerBattle,
    implementation: implementationFingerprint(projectRoot), experimentSummary: experimentSummary(runs),
    config: GAME_CONFIG, strategyDefinitions: STRATEGY_DEFINITIONS, upgradePaths: UPGRADE_PATHS,
    metricDefinitions: METRIC_DEFINITIONS,
    scenarios: CHALLENGE_SCENARIOS.map(s => ({ ...s, scenarioId: scenarioId(s) })), results });
}
export const IMPLEMENTATION_FILES = Object.freeze([
  "lib/simulation/run-challenge-diagnostics-r1.ts",
  "lib/simulation/serialize-challenge-diagnostics-r1.ts",
  "scripts/run-challenge-diagnostics-r1.mjs",
  "lib/simulation/verify-challenge-diagnostics-r1.ts",
]);
export function implementationFingerprint(projectRoot = process.cwd()) {
  return Object.fromEntries(IMPLEMENTATION_FILES.map(file => [file, createHash("sha256").update(readFileSync(path.join(projectRoot, file))).digest("hex")]));
}
function experimentSummary(runs: readonly ChallengeDiagnostics[]) {
  const fields = ["startedBattles", "completedBattles", ...counters, ...damages, "overkillDamageTaken", "overkillDamageDealt"] as const;
  return { scenarios: runs.length, victory: runs.filter(r => r.summary.outcome === "victory").length,
    defeat: runs.filter(r => r.summary.outcome === "defeat").length, timeout: runs.filter(r => r.summary.outcome === "timeout").length,
    error: runs.filter(r => r.summary.outcome === "error").length,
    ...Object.fromEntries(fields.map(key => [key, runs.reduce((sum, run) => sum + run.summary[key], 0)])),
  };
}
export function validateChallengeExperiment(value: unknown, projectRoot = process.cwd()) {
  canonical(value);
  const data = object(value, "experiment");
  const runs = array(data.results, "results") as unknown as ChallengeDiagnostics[];
  member(data.coverage, ["full", "representative"], "coverage");
  // Only explicitly defined fields are projected from stored results; derived fields
  // are recomputed and the entire envelope is compared, including config/fingerprints.
  const inputs = runs.map(run => ({ execution: run.execution, scenario: run.scenario,
    summary: run.summary, battles: run.battles, upgrades: run.upgrades }));
  const expected = createChallengeExperiment(inputs, data.coverage as "full" | "representative", projectRoot);
  same(data, expected, "experiment envelope");
  return { csv: challengeDiagnosticsCsv(inputs), experiment: expected };
}
export function challengeDiagnosticsJson(runs: readonly ChallengeDiagnostics[], coverage: "full" | "representative" = "full", projectRoot = process.cwd()): string {
  return JSON.stringify(createChallengeExperiment(runs, coverage, projectRoot), null, 2) + "\n";
}
