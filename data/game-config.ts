import type { ActionId, EnemyId, UpgradeId } from "../lib/game/types";

interface ActionConfig {
  readonly damage: number;
  readonly cost: number;
  readonly gain: number;
  readonly reduction: number;
}
interface EnemyConfig {
  readonly maxHp: number;
  readonly damage: number;
  readonly specialDamage: number | null;
  readonly specialEvery: number | null;
}
interface UpgradeConfig {
  readonly damage: number;
  readonly energyCap: number;
  readonly reduction: number;
}

/** Immutable base values; upgrades live in progress, never in this configuration. */
export const GAME_CONFIG = Object.freeze({
  player: Object.freeze({ maxHp: 100, initialHp: 100, initialEnergy: 2, energyCap: 4 }),
  actions: Object.freeze({
    attack: Object.freeze({ damage: 12, cost: 0, gain: 0, reduction: 0 }),
    heavy: Object.freeze({ damage: 25, cost: 2, gain: 0, reduction: 0 }),
    defend: Object.freeze({ damage: 0, cost: 0, gain: 1, reduction: 12 }),
    charge: Object.freeze({ damage: 0, cost: 0, gain: 2, reduction: 0 }),
  } satisfies Record<ActionId, ActionConfig>),
  enemies: Object.freeze({
    light: Object.freeze({ maxHp: 42, damage: 9, specialDamage: null, specialEvery: null }),
    heavy: Object.freeze({ maxHp: 60, damage: 13, specialDamage: null, specialEvery: null }),
    boss: Object.freeze({ maxHp: 120, damage: 12, specialDamage: 22, specialEvery: 3 }),
  } satisfies Record<EnemyId, EnemyConfig>),
  upgrades: Object.freeze({
    blade: Object.freeze({ damage: 3, energyCap: 0, reduction: 0 }),
    core: Object.freeze({ damage: 0, energyCap: 1, reduction: 0 }),
    armor: Object.freeze({ damage: 0, energyCap: 0, reduction: 6 }),
  } satisfies Record<UpgradeId, UpgradeConfig>),
});
