/** R2 is an isolated reconstruction experiment, never a replacement GAME_CONFIG. */
export interface DefenseMechanism {
  readonly id: string;
  readonly defenseCost: number;
  readonly defenseGain: number;
  readonly defenseReduction: number;
  readonly defenseReductionMultipliers: readonly number[];
}
const mechanism = (id: string, defenseCost: number, defenseGain: number, decay: boolean): DefenseMechanism =>
  Object.freeze({ id, defenseCost, defenseGain, defenseReduction: 12,
    defenseReductionMultipliers: Object.freeze(decay ? [1, 0.75, 0.5, 0.25, 0] : [1]) });
export const R1_CONTROL = mechanism("R1-control", 0, 1, false);
export const R2_GROUPS = Object.freeze([
  mechanism("R2-A", 0, 0, false), mechanism("R2-B", 1, 0, false),
  mechanism("R2-C", 0, 0, true), mechanism("R2-D", 1, 0, true),
]);
export function validateMechanism(value: DefenseMechanism): void {
  if (!value || typeof value.id !== "string" || !value.id.length
    || ![value.defenseCost, value.defenseGain].every(x => Number.isSafeInteger(x) && x >= 0)
    || !Number.isFinite(value.defenseReduction) || value.defenseReduction < 0
    || !Array.isArray(value.defenseReductionMultipliers) || !value.defenseReductionMultipliers.length
    || Array.from(value.defenseReductionMultipliers).some(x => !Number.isFinite(x) || x < 0 || x > 1)) {
    throw new TypeError("Invalid R2 defense mechanism");
  }
}
