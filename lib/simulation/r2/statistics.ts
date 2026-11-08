import type { R2Battle } from "./runner";

/** Pure derivation from recorded transitions; no runner counters or strategy assumptions. */
export function summarizeR2(battles: readonly R2Battle[]) {
  const result = { startedBattles: battles.length, completedBattles: 0, actionAttempts: 0, playerActions: 0,
    attackCount: 0, heavyCount: 0, defendCount: 0, chargeCount: 0, defenseUses: 0, defenseReduction: 0,
    defenseEnergySpent: 0, defenseEnergyGained: 0, maxDefenseStreak: 0,
    defenseStreakDistribution: {} as Record<string, number>, rawHpLoss: 0, effectiveHpLoss: 0,
    rawDamageDealt: 0, effectiveDamageDealt: 0, enemyAttacks: 0, bossNormalAttacks: 0, bossSpecialAttacks: 0,
    finalHp: 100, finalEnergy: 2 };
  for (const battle of battles) {
    if (battle.outcome === "victory") result.completedBattles++;
    let streak = 0;
    const flush = () => { if (streak) {
      result.defenseStreakDistribution[streak] = (result.defenseStreakDistribution[streak] ?? 0) + 1;
      result.maxDefenseStreak = Math.max(result.maxDefenseStreak, streak); streak = 0;
    } };
    for (const a of battle.actions) {
      result.actionAttempts++;
      if (!a.accepted || !a.effects?.accepted) continue;
      result.playerActions++;
      result[`${a.decision.action}Count`]++;
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
    flush(); result.finalHp = battle.final.battle.player.hp; result.finalEnergy = battle.final.battle.player.energy;
  }
  return result;
}
