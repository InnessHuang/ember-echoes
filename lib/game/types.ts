export type EnemyId = "light" | "heavy" | "boss";
export type ActionId = "attack" | "heavy" | "defend" | "charge";
export type UpgradeId = "blade" | "core" | "armor";
export type BattlePhase = "ongoing" | "victory" | "defeat";

export interface PlayerProgress {
  readonly hp: number;
  readonly upgrades: Readonly<Record<UpgradeId, number>>;
}

export interface BattleState {
  readonly player: PlayerProgress & {
    readonly energy: number;
    readonly energyCap: number;
  };
  readonly enemy: { readonly id: EnemyId; readonly hp: number };
  /** Next player turn, starting at 1; increments after each accepted action. */
  readonly turn: number;
  readonly phase: BattlePhase;
  readonly enemyAttacksExecuted: number;
}

export interface EnemyIntent {
  readonly kind: "normal" | "special";
  readonly damage: number;
  readonly attackNumber: number;
}

export interface ActionEffects {
  readonly playerDamage: number;
  readonly enemyIntent: EnemyIntent | null;
  readonly damageTaken: number;
}

export type ActionResult =
  | { readonly accepted: true; readonly state: BattleState; readonly effects: ActionEffects }
  | {
      readonly accepted: false;
      readonly state: BattleState;
      readonly reason: "battle-ended" | "insufficient-energy" | "unknown-action";
    };
