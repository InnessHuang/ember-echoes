import { GAME_CONFIG as config } from "../../data/game-config";
import type {
  ActionId, ActionResult, BattleState, EnemyId, EnemyIntent, PlayerProgress, UpgradeId,
} from "./types";

export function createInitialProgress(): PlayerProgress {
  return { hp: config.player.initialHp, upgrades: { blade: 0, core: 0, armor: 0 } };
}

export function applyUpgrade(progress: PlayerProgress, upgradeId: UpgradeId): PlayerProgress {
  return {
    hp: progress.hp,
    upgrades: { ...progress.upgrades, [upgradeId]: progress.upgrades[upgradeId] + 1 },
  };
}

export function startBattle(enemyId: EnemyId, progress: PlayerProgress): BattleState {
  return {
    player: {
      hp: progress.hp,
      upgrades: { ...progress.upgrades },
      energy: config.player.initialEnergy,
      energyCap: config.player.energyCap + progress.upgrades.core * config.upgrades.core.energyCap,
    },
    enemy: { id: enemyId, hp: config.enemies[enemyId].maxHp },
    turn: 1,
    phase: progress.hp <= 0 ? "defeat" : "ongoing",
    enemyAttacksExecuted: 0,
  };
}

export function getEnemyIntent(state: BattleState): EnemyIntent | null {
  if (state.phase !== "ongoing") return null;
  const enemy = config.enemies[state.enemy.id];
  const attackNumber = state.enemyAttacksExecuted + 1;
  const special = enemy.specialEvery !== null && attackNumber % enemy.specialEvery === 0;
  return {
    kind: special ? "special" : "normal",
    damage: special ? enemy.specialDamage! : enemy.damage,
    attackNumber,
  };
}

export function performAction(state: BattleState, actionId: ActionId): ActionResult {
  if (state.phase !== "ongoing") return { accepted: false, state, reason: "battle-ended" };
  if (!Object.hasOwn(config.actions, actionId)) return { accepted: false, state, reason: "unknown-action" };
  const action = config.actions[actionId];
  if (state.player.energy < action.cost) return { accepted: false, state, reason: "insufficient-energy" };

  const playerDamage = action.damage + (actionId === "attack" || actionId === "heavy"
    ? state.player.upgrades.blade * config.upgrades.blade.damage : 0);
  const reduction = actionId === "defend"
    ? action.reduction + state.player.upgrades.armor * config.upgrades.armor.reduction : 0;
  const energy = Math.min(state.player.energyCap, Math.max(0, state.player.energy - action.cost + action.gain));
  const enemyHp = state.enemy.hp - playerDamage;
  const intent = enemyHp <= 0 ? null : getEnemyIntent(state);
  const damageTaken = intent === null ? 0 : Math.max(0, intent.damage - reduction);
  const hp = state.player.hp - damageTaken;
  return {
    accepted: true,
    state: {
      player: { ...state.player, upgrades: { ...state.player.upgrades }, hp, energy },
      enemy: { ...state.enemy, hp: enemyHp },
      turn: state.turn + 1,
      phase: enemyHp <= 0 ? "victory" : hp <= 0 ? "defeat" : "ongoing",
      enemyAttacksExecuted: state.enemyAttacksExecuted + (intent === null ? 0 : 1),
    },
    effects: { playerDamage, enemyIntent: intent, damageTaken },
  };
}

export function getPlayerProgress(state: BattleState): PlayerProgress {
  return { hp: state.player.hp, upgrades: { ...state.player.upgrades } };
}
