import { isDeepStrictEqual } from "node:util";
import { applyUpgrade, createInitialProgress, getEnemyIntent, getPlayerProgress, performAction, startBattle } from "../game/engine";
import type { ActionId } from "../game/types";
import { STRATEGIES } from "./strategies";
import type { ChallengeDiagnostics } from "./run-challenge-diagnostics-r1";

const enemies = ["light", "heavy", "boss"] as const;
const metricKeys = ["actionAttempts", "playerActions", "enemyAttacks", "totalDamageTaken", "totalDamageDealt", "rawHpLossTaken", "rawHpLossDealt", "attackCount", "heavyCount", "defendCount", "chargeCount", "bossNormalAttacks", "bossSpecialAttacks"] as const;
function equal(actual: unknown, expected: unknown, location: string): void {
  if (!isDeepStrictEqual(actual, expected, { skipPrototype: true })) throw new TypeError(`Trace verification failed at ${location}`);
}
function requireTrue(value: boolean, location: string): void { if (!value) throw new TypeError(`Trace verification failed at ${location}`); }
const zero = () => Object.fromEntries(metricKeys.map(k => [k, 0])) as Record<typeof metricKeys[number], number>;

/** Independent verifier: never calls the challenge runner/controller, never trusts recorded totals.
 * Normal experimental assets accept only reproducible registered-policy runs, not error/test-hook runs.
 * Caller performs JSON-shape validation before invoking this typed replay function.
 */
export function verifyChallengeTrace(run: ChallengeDiagnostics): void {
  if (run.summary.outcome === "error") throw new TypeError(`Error result cannot be a completed experiment: ${run.summary.reason}`);
  const limit = run.execution.maxActionsPerBattle, totals = zero();
  let progress = createInitialProgress(), completed = 0;
  let lastState = startBattle("light", progress);
  let lastOutcome = "timeout", lastReason: string | null = null;
  for (const [index, battle] of run.battles.entries()) {
    let cursor = startBattle(enemies[index], progress);
    equal(battle.initialState, cursor, `battle ${index} initialState`);
    equal(battle.execution, run.execution, `battle ${index} execution`);
    const metrics = zero(), counts: Record<ActionId, number> = { attack: 0, heavy: 0, defend: 0, charge: 0 };
    for (const [n, step] of battle.actions.entries()) {
      requireTrue(cursor.phase === "ongoing" && n < limit, `battle ${index} action after terminal/limit`);
      const intent = getEnemyIntent(cursor), action = STRATEGIES[run.scenario.strategyId](cursor, intent);
      const result = performAction(cursor, action);
      requireTrue(result.accepted, `battle ${index} rejected registered action`);
      if (!result.accepted) throw new TypeError(result.reason);
      equal(step, { attempt: n + 1, action, intentBefore: intent, before: cursor, after: result.state,
        accepted: true, effects: result.effects, error: null }, `battle ${index} action ${n + 1}`);
      const next = result.state, delta = next.enemyAttacksExecuted - cursor.enemyAttacksExecuted;
      requireTrue(delta === (result.effects.enemyIntent === null ? 0 : 1), "actual enemy attack delta");
      metrics.actionAttempts++; metrics.playerActions++; counts[action]++;
      metrics.enemyAttacks += delta;
      metrics.rawHpLossTaken += cursor.player.hp - next.player.hp;
      metrics.rawHpLossDealt += cursor.enemy.hp - next.enemy.hp;
      metrics.totalDamageTaken += Math.max(0, cursor.player.hp) - Math.max(0, next.player.hp);
      metrics.totalDamageDealt += Math.max(0, cursor.enemy.hp) - Math.max(0, next.enemy.hp);
      if (enemies[index] === "boss" && result.effects.enemyIntent) {
        if (result.effects.enemyIntent.kind === "special") metrics.bossSpecialAttacks++; else metrics.bossNormalAttacks++;
      }
      cursor = next;
    }
    metrics.attackCount = counts.attack; metrics.heavyCount = counts.heavy;
    metrics.defendCount = counts.defend; metrics.chargeCount = counts.charge;
    requireTrue(battle.actions.length > 0, "empty normal battle");
    const outcome = cursor.phase === "ongoing" ? "timeout" : cursor.phase;
    if (outcome === "timeout") equal(metrics.playerActions, limit, `battle ${index} premature timeout`);
    const reason = outcome === "timeout" ? `Still ongoing after ${limit} accepted player actions` : null;
    equal(battle.finalState, cursor, `battle ${index} finalState`);
    equal(battle.summary, { enemyId: enemies[index], strategyId: run.scenario.strategyId,
      initialPlayerHp: battle.initialState.player.hp, initialEnergy: battle.initialState.player.energy,
      initialEnergyCap: battle.initialState.player.energyCap, initialEnemyHp: battle.initialState.enemy.hp,
      outcome, reason, ...metrics,
      overkillDamageTaken: metrics.rawHpLossTaken - metrics.totalDamageTaken,
      overkillDamageDealt: metrics.rawHpLossDealt - metrics.totalDamageDealt,
      playerHp: cursor.player.hp, enemyHp: cursor.enemy.hp, finalEnergy: cursor.player.energy,
    }, `battle ${index} recomputed summary`);
    for (const key of metricKeys) totals[key] += metrics[key];
    if (outcome === "victory") completed++;
    if (outcome === "victory" && index < 2) {
      requireTrue(index + 1 < run.battles.length, "missing next battle after victory");
      progress = applyUpgrade(getPlayerProgress(cursor), run.scenario.upgradePath[index]);
      equal(run.upgrades[index], { encounter: index, upgrade: run.scenario.upgradePath[index], before: cursor,
        after: startBattle(enemies[index + 1], progress) }, `upgrade ${index}`);
    } else requireTrue(index === run.battles.length - 1, "continued after challenge terminal");
    lastState = cursor; lastOutcome = outcome; lastReason = reason;
  }
  equal(run.upgrades.length, run.battles.length - 1, "upgrade count");
  equal(run.summary, { outcome: lastOutcome, reason: lastReason, startedBattles: run.battles.length,
    completedBattles: completed, ...totals,
    overkillDamageTaken: totals.rawHpLossTaken - totals.totalDamageTaken,
    overkillDamageDealt: totals.rawHpLossDealt - totals.totalDamageDealt,
    playerHp: lastState.player.hp, enemyHp: lastState.enemy.hp, finalEnergy: lastState.player.energy,
  }, "challenge recomputed summary");
}

/** Diagnostics retain the exact raw object, including non-JSON values, on failure.
 * This inspection result is never accepted as a completed serialized experiment.
 */
export function inspectChallengeTrace(run: ChallengeDiagnostics) {
  try { verifyChallengeTrace(run); return { valid: true as const }; }
  catch (error) { return { valid: false as const, reason: error instanceof Error ? error.message : String(error), raw: run }; }
}
