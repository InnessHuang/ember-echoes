import type { ActionEffects, ActionId, BattleState, EnemyId, EnemyIntent } from "../game/types";

export type StrategyId = "A" | "B" | "C" | "D" | "E" | "F";
export type Strategy = (state: BattleState, intent: EnemyIntent | null) => ActionId;
export interface Scenario {
  readonly enemyId: EnemyId;
  readonly strategyId: StrategyId;
}
export type SimulationOutcome = "victory" | "defeat" | "timeout" | "error";
export interface ActionTrace {
  readonly attempt: number;
  readonly action: ActionId | null;
  readonly intentBefore: EnemyIntent | null;
  readonly before: BattleState;
  readonly after: BattleState;
  readonly accepted: boolean;
  readonly effects: ActionEffects | null;
  readonly error: string | null;
}
export interface SimulationSummary extends Scenario {
  readonly initialPlayerHp: number;
  readonly initialEnergy: number;
  readonly initialEnergyCap: number;
  readonly initialEnemyHp: number;
  readonly outcome: SimulationOutcome;
  readonly actionAttempts: number;
  readonly playerActions: number;
  readonly enemyAttacks: number;
  /** Raw engine HP can be negative; effective losses below exclude overkill. */
  readonly playerHp: number;
  readonly enemyHp: number;
  readonly finalEnergy: number;
  readonly totalDamageTaken: number;
  readonly totalDamageDealt: number;
  readonly rawHpLossTaken: number;
  readonly rawHpLossDealt: number;
  readonly attackCount: number;
  readonly heavyCount: number;
  readonly defendCount: number;
  readonly chargeCount: number;
  readonly bossNormalAttacks: number;
  readonly bossSpecialAttacks: number;
  readonly reason: string | null;
}
export interface SimulationResult {
  readonly summary: SimulationSummary;
  readonly initialState: BattleState;
  readonly finalState: BattleState;
  readonly actions: readonly ActionTrace[];
}
