import type { R2Battle } from "./runner";

/** Verified metrics are conservative; observed metrics preserve accepted-but-unverified engine output separately. */
export function summarizeR2(battles: readonly R2Battle[]) {
  const result = {
    startedBattles: battles.length, completedBattles: 0, actionAttempts: 0,
    engineAcceptedActions: 0, verifiedActions: 0, acceptedUnverifiedActions: 0,
    playerActions: 0, attackCount: 0, heavyCount: 0, defendCount: 0, chargeCount: 0,
    defenseUses: 0, defenseReduction: 0, defenseEnergySpent: 0, defenseEnergyGained: 0,
    maxDefenseStreak: 0, defenseStreakDistribution: {} as Record<string, number>,
    rawHpLoss: 0, effectiveHpLoss: 0, rawDamageDealt: 0, effectiveDamageDealt: 0,
    enemyAttacks: 0, bossNormalAttacks: 0, bossSpecialAttacks: 0,
    observedRawHpLoss: 0, observedRawDamageDealt: 0, observedEnemyAttacks: 0,
    finalHp: 100 as number | null, finalEnergy: 2 as number | null, finalHpAvailable: true, finalHpVerified: true
  };
  for (const battle of battles) {
    if (battle.outcome === "victory") result.completedBattles++;
    let streak = 0;
    const flush = () => { if (streak) {
      result.defenseStreakDistribution[streak] = (result.defenseStreakDistribution[streak] ?? 0) + 1;
      result.maxDefenseStreak = Math.max(result.maxDefenseStreak, streak); streak = 0;
    } };
    for (const a of battle.actions) {
      result.actionAttempts++;
      const observedAccepted = a.engineAccepted === true;
      if (observedAccepted) result.engineAcceptedActions++;
      if (observedAccepted && a.stateSource !== "unavailable") {
        const pre = a.before.battle, post = a.after.battle;
        result.observedRawHpLoss += pre.player.hp - post.player.hp;
        result.observedRawDamageDealt += pre.enemy.hp - post.enemy.hp;
        result.observedEnemyAttacks += post.enemyAttacksExecuted - pre.enemyAttacksExecuted;
      }
      if (!a.accepted || !a.effects?.accepted) {
        if (observedAccepted) result.acceptedUnverifiedActions++;
        continue;
      }
      result.verifiedActions++;
      result.playerActions++;
      switch (a.decision.action) {
        case "attack": result.attackCount++; break;
        case "heavy": result.heavyCount++; break;
        case "defend": result.defendCount++; break;
        case "charge": result.chargeCount++; break;
      }
      const pre = a.before.battle, post = a.after.battle;
      result.rawHpLoss += pre.player.hp - post.player.hp;
      result.effectiveHpLoss += Math.max(0, pre.player.hp) - Math.max(0, post.player.hp);
      result.rawDamageDealt += pre.enemy.hp - post.enemy.hp;
      result.effectiveDamageDealt += Math.max(0, pre.enemy.hp) - Math.max(0, post.enemy.hp);
      result.enemyAttacks += post.enemyAttacksExecuted - pre.enemyAttacksExecuted;
      const intent = a.effects.effects.enemyIntent;
      if (pre.enemy.id === "boss" && intent) result[intent.kind === "normal" ? "bossNormalAttacks" : "bossSpecialAttacks"]++;
      if (a.decision.action === "defend") {
        streak++; result.defenseUses++;
        result.defenseReduction += (intent?.damage ?? 0) - (pre.player.hp - post.player.hp);
        result.defenseEnergySpent += a.defense?.energySpent ?? 0;
        result.defenseEnergyGained += a.defense?.energyGained ?? 0;
      } else flush();
    }
    flush();
    result.finalHp = battle.finalStateAvailable ? battle.final.battle.player.hp : null;
    result.finalEnergy = battle.finalStateAvailable ? battle.final.battle.player.energy : null;
    result.finalHpAvailable = battle.finalStateAvailable;
    const terminalError = battle.actions.at(-1);
    const failedBeforeExecution = battle.outcome === "error" && terminalError
      && ["snapshot", "intent", "policy", "decision-validation"].includes(terminalError.errorStage ?? "");
    result.finalHpVerified = battle.finalStateAvailable && (battle.outcome !== "error" || failedBeforeExecution);
  }
  return result;
}
