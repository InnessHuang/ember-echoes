import { describe, expect, it, vi, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { isDeepStrictEqual } from "node:util";
import { startBattle, getEnemyIntent } from "../lib/game/engine";
import type { ActionId, EnemyId } from "../lib/game/types";
import { R2_GROUPS, R1_CONTROL } from "../lib/simulation/r2/config";
import { performR2Action, type R2State } from "../lib/simulation/r2/mechanics";
import { chooseR2Policy, type R2PolicyVersion } from "../lib/simulation/r2/policy";
import * as policy from "../lib/simulation/r2/policy";
import { assessR2Actions, chooseAdaptiveAction } from "../lib/simulation/r2/adaptive-strategies";
import { runR2Challenge } from "../lib/simulation/r2/runner";
import { verifyR2Run } from "../lib/simulation/r2/verify";
import { R2_MATRIX_PLAN } from "../lib/simulation/r2/matrix-plan";
import type { StrategyId } from "../lib/simulation/types";

const policies: readonly [StrategyId, R2PolicyVersion][] = [
  ["A", "R2-compat-A-v1"], ["B", "R2-compat-B-v1"], ["C", "R2-compat-C-v1"],
  ["D", "R2-compat-D-v1"], ["E", "R2-compat-E-v1"], ["F", "R2-compat-F-v1"],
  ["D", "R2-adaptive-D-v1"], ["E", "R2-adaptive-E-v1"],
];
function fixture(enemy: EnemyId, energy: number, streak: number, armor: number, hp: number, enemyHp: number, special = false): R2State {
  const b = startBattle(enemy, { hp, upgrades: { blade: 0, core: 0, armor } });
  return { battle: { ...b, player: { ...b.player, energy }, enemy: { id: enemy, hp: enemyHp },
    enemyAttacksExecuted: special ? 2 : 0 }, consecutiveDefenses: streak };
}
/** Independent reference for historical decisions, intentionally not calling STRATEGIES. */
function compatIntent(s: R2State, id: StrategyId): ActionId {
  const b = s.battle, intent = getEnemyIntent(b), baseline = b.player.energy >= 2 ? "heavy" : "attack";
  if (id === "A") return "attack";
  if (id === "B") return baseline;
  if (id === "C") return b.player.energy < b.player.energyCap ? "charge" : "heavy";
  if (id === "D") return intent && b.player.hp <= intent.damage && b.player.hp > Math.max(0, intent.damage - 12 - b.player.upgrades.armor * 6) ? "defend" : baseline;
  if (id === "E") return b.player.energy < 2 && intent ? "defend" : baseline;
  return b.enemy.hp <= 12 + b.player.upgrades.blade * 3 ? "attack"
    : b.player.energy >= 2 && b.enemy.hp <= 25 + b.player.upgrades.blade * 3 ? "heavy" : baseline;
}
afterEach(() => vi.restoreAllMocks());
describe("final audit of static decision boundaries (not challenge matrix)", () => {
  it.each(R2_GROUPS)("$id all enemies, energies 0–2, streaks 0–5, lethal and kill boundaries", config => {
    let states = 0, decisions = 0;
    for (const enemy of ["light", "heavy", "boss"] as const)
      for (const special of enemy === "boss" ? [false, true] : [false])
        for (const energy of [0, 1, 2]) for (const streak of [0, 1, 2, 3, 4, 5])
          for (const armor of [0, 1, 2]) for (const hp of [1, 9, 12, 13, 22, 23]) for (const enemyHp of [1, 12, 25, 120]) {
            const s = fixture(enemy, energy, streak, armor, hp, enemyHp, special), before = structuredClone(s);
            const assessment = assessR2Actions(s, config);
            for (const candidate of assessment.candidates) {
              const actual = performR2Action(s, candidate.action, config);
              if (!actual.result.accepted || candidate.hpAfter !== actual.state.battle.player.hp
                || candidate.energyAfter !== actual.state.battle.player.energy
                || candidate.playerDamage !== actual.result.effects.playerDamage
                || candidate.victory !== (actual.state.battle.phase === "victory")
                || candidate.survives !== (actual.state.battle.phase !== "defeat")) throw new Error(`Forecast mismatch ${JSON.stringify({ config, s, candidate })}`);
            }
            for (const [id, version] of policies) {
              const chosen = chooseR2Policy(s, id, config, version);
              const step = performR2Action(s, chosen.decision.action, config);
              if (!step.result.accepted) throw new Error(`Illegal decision ${version}`);
              if (version.includes("compat")) {
                const intent = compatIntent(s, id), expected = intent === "defend" && energy < config.defenseCost ? "charge" : intent;
                if (chosen.decision.originalIntent !== intent || chosen.decision.action !== expected) throw new Error(`Compat drift ${version}`);
              } else {
                const kill = assessment.candidates.find(x => x.action === "attack" && x.victory)
                  ?? assessment.candidates.find(x => x.action === "heavy" && x.victory);
                if (kill && chosen.decision.action !== kill.action) throw new Error("Kill precedence mismatch");
              }
              decisions++;
            }
            if (!isDeepStrictEqual(s, before)) throw new Error("Cross-decision state mutation");
            states++;
          }
    expect(states).toBe(5184); expect(decisions).toBe(41472);
  }, 30000);
  it("E rule precedence covers emergency, energy, special, normal and forced-death decisions", () => {
    const [A, B, C, D] = R2_GROUPS;
    const cases = [
      [fixture("boss", 2, 0, 1, 15, 120, true), D, "defend", "saving-defense"],
      [fixture("boss", 0, 0, 2, 7, 120), B, "charge", "saving-defense-unaffordable"],
      [fixture("boss", 0, 0, 2, 100, 120, true), A, "charge", "restore-heavy-energy"],
      [fixture("boss", 2, 0, 1, 100, 120, true), A, "defend", "special-defense-preserves-heavy"],
      [fixture("boss", 2, 0, 1, 100, 120, true), B, "heavy", "surviving-resource-plan"],
      [fixture("boss", 2, 0, 1, 100, 120), A, "heavy", "surviving-resource-plan"],
      [fixture("boss", 2, 5, 2, 1, 120, true), C, "heavy", "unavoidable-defeat-best-endpoint"],
    ] as const;
    for (const [s, config, action, reason] of cases) {
      const selected = chooseAdaptiveAction(s, "R2-adaptive-E-v1", config);
      expect(selected.decision.action).toBe(action); expect(selected.evidence.reason).toBe(reason);
    }
  });
  it("rejecting unpaid defense does not reset a decayed streak; charge resets it", () => {
    const s = fixture("heavy", 0, 5, 1, 100, 60), config = R2_GROUPS[3];
    expect(performR2Action(s, "defend", config).state).toBe(s);
    const charged = performR2Action(s, "charge", config).state;
    expect(charged.consecutiveDefenses).toBe(0);
    expect(performR2Action(charged, "defend", config).defense?.multiplier).toBe(1);
  });
  it.each(["R2-compat-D-v1", "R2-compat-E-v1", "R2-adaptive-D-v1", "R2-adaptive-E-v1"] as R2PolicyVersion[])("free no-decay %s can sustain no-output defense", version => {
    const id = version.includes("-D-") ? "D" : "E";
    let s = fixture("boss", 0, 0, 2, 7, 120);
    for (let i = 0; i < 9; i++) {
      const action = chooseR2Policy(s, id, R2_GROUPS[0], version).decision.action;
      expect(action).toBe("defend"); s = performR2Action(s, action, R2_GROUPS[0]).state;
      expect(s.battle.player.hp).toBe(7); expect(s.battle.player.energy).toBe(0); expect(s.battle.enemy.hp).toBe(120);
    }
  });
  it("decay removes zero-damage shielding by fifth consecutive defense without inventing energy", () => {
    let s = fixture("light", 0, 0, 2, 100, 42);
    for (let i = 0; i < 5; i++) s = performR2Action(s, "defend", R2_GROUPS[2]).state;
    expect(s.battle.player.hp).toBeLessThan(100);
    expect(s.battle.player.energy).toBe(0); expect(s.battle.enemy.hp).toBe(42);
    expect(performR2Action(s, "defend", R2_GROUPS[2]).defense?.damagePrevented).toBe(0);
  });
  it.each(policies)("Blade/Core caps and kill thresholds remain legal for %s/%s", (id, version) => {
    for (const config of R2_GROUPS) for (const blade of [1, 2]) for (const core of [1, 2]) {
      const s = fixture("boss", 2, 2, 0, 22, 12 + blade * 3, true);
      const changed = { ...s, battle: { ...s.battle, player: { ...s.battle.player, energyCap: 4 + core, upgrades: { blade, core, armor: 0 } } } };
      expect(performR2Action(changed, chooseR2Policy(changed, id, config, version).decision.action, config).result.accepted).toBe(true);
      expect(compatIntent(changed, "F")).toBe("attack");
      if (id === "C") expect(chooseR2Policy(changed, id, config, version).decision.action).toBe("charge");
    }
  });
});
describe("challenge transitions and exact final allowed action", () => {
  it("core/core crosses both upgrades with inherited HP and all new-battle resets", () => {
    const run = runR2Challenge({ strategyId: "A", upgradePath: ["core", "core"] }, R2_GROUPS[0]);
    verifyR2Run(run); expect(run.battles).toHaveLength(3); expect(run.upgrades).toHaveLength(2);
    run.battles.forEach((b, i) => {
      expect(b.initial.battle.player.energy).toBe(2); expect(b.initial.battle.player.energyCap).toBe(4 + i);
      expect(b.initial.battle.player.upgrades.core).toBe(i); expect(b.initial.consecutiveDefenses).toBe(0);
      expect(b.initial.battle.turn).toBe(1); expect(b.initial.battle.enemyAttacksExecuted).toBe(0);
      if (i) expect(b.initial.battle.player.hp).toBe(run.battles[i - 1].final.battle.player.hp);
    });
  });
  it("engine victory at action 200 and runner timeout at action 200 retain distinct outcomes", () => {
    const plan = { strategyId: "E" as const, upgradePath: ["core", "core"] as const };
    const run = runR2Challenge(plan, R2_GROUPS[0], 200);
    // R2-A E has no energy recovery after opening heavy; Light defense does zero damage forever.
    expect(run.outcome).toBe("timeout"); expect(run.battles[0].actions).toHaveLength(200); verifyR2Run(run);
    // Engine boundary independent of policy reachability: exact 200th accepted attack kills.
    let s = fixture("light", 2, 0, 0, 10000, 2400);
    for (let i = 0; i < 200; i++) s = performR2Action(s, "attack", R2_GROUPS[0]).state;
    expect(s.battle.phase).toBe("victory"); expect(s.battle.enemyAttacksExecuted).toBe(199);
  });
  it("defeat at action 200 stays defeat; earlier rejected actions do not consume accepted limit", () => {
    let s = fixture("light", 0, 0, 0, 1800, 10000), accepted = 0;
    expect(performR2Action(s, "defend", R2_GROUPS[1]).result.accepted).toBe(false);
    for (let i = 0; i < 200; i++) { const step = performR2Action(s, "attack", R2_GROUPS[1]); expect(step.result.accepted).toBe(true); s = step.state; accepted++; }
    expect(accepted).toBe(200); expect(s.battle.phase).toBe("defeat"); expect(s.battle.player.hp).toBe(0);
  });
  it("a successful representative Boss victory has exactly two upgrades and no counter on kill", () => {
    const run = runR2Challenge({ strategyId: "E", upgradePath: ["armor", "armor"] }, R1_CONTROL);
    expect(run.outcome).toBe("victory"); expect(run.upgrades).toHaveLength(2); verifyR2Run(run);
    const final = run.battles[2].actions.at(-1)!;
    expect(final.after.battle.enemyAttacksExecuted).toBe(final.before.battle.enemyAttacksExecuted);
  });
  it("previous audit issue is fixed: strategy exception preserves an error trace", () => {
    vi.spyOn(policy, "chooseR2Policy").mockImplementation(() => { throw new Error("audit policy fault"); });
    const run = runR2Challenge({ strategyId: "E", upgradePath: ["armor", "armor"] }, R2_GROUPS[0]);
    expect(run.outcome).toBe("error"); expect(run.error).toBe("audit policy fault");
    expect(run.battles[0].actions[0].errorStage).toBe("policy");
    expect(() => verifyR2Run(run)).not.toThrow();
  });
});
describe("fixed experiment design inventory, never executing it", () => {
  it("has exactly 288 unique fixed-order paired scenarios and matches the CSV inventory", () => {
    expect(R2_MATRIX_PLAN).toHaveLength(288);
    expect(new Set(R2_MATRIX_PLAN.map(x => x.scenarioId)).size).toBe(288);
    const expected = ["ordinal,scenario_id,mechanism_id,strategy_version,source_strategy_id,upgrade_1,upgrade_2,max_actions_per_battle",
      ...R2_MATRIX_PLAN.map((x, i) => [i + 1, x.scenarioId, x.mechanismId, x.policyVersion, x.strategyId, ...x.upgradePath, 200].join(","))].join("\n") + "\n";
    expect(readFileSync(new URL("../docs/R2_MATRIX_PLAN_288.csv", import.meta.url), "utf8")).toBe(expected);
    expect(R2_MATRIX_PLAN[0].scenarioId).toBe("R2-A__blade-blade__R2-compat-A-v1");
    expect(R2_MATRIX_PLAN.at(-1)!.scenarioId).toBe("R2-D__armor-armor__R2-adaptive-E-v1");
    for (const g of R2_GROUPS) expect(R2_MATRIX_PLAN.filter(x => x.mechanismId === g.id)).toHaveLength(72);
    for (const [, version] of policies) expect(R2_MATRIX_PLAN.filter(x => x.policyVersion === version)).toHaveLength(36);
    for (const first of ["blade", "core", "armor"]) for (const second of ["blade", "core", "armor"]) {
      expect(R2_MATRIX_PLAN.filter(x => x.upgradePath[0] === first && x.upgradePath[1] === second)).toHaveLength(32);
    }
    expect(Object.isFrozen(R2_MATRIX_PLAN)).toBe(true);
  });
});
