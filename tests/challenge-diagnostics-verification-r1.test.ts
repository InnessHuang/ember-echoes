import { describe, expect, it } from "vitest";
import { runChallengeDiagnostics, type ChallengeDiagnostics } from "../lib/simulation/run-challenge-diagnostics-r1";
import { inspectChallengeTrace, verifyChallengeTrace } from "../lib/simulation/verify-challenge-diagnostics-r1";
import { challengeDiagnosticsCsv, challengeDiagnosticsJson } from "../lib/simulation/serialize-challenge-diagnostics-r1";
const win = runChallengeDiagnostics({ strategyId: "E", upgradePath: ["armor", "armor"] });
describe("independent challenge trace verification", () => {
  it.each([
    { strategyId: "A", upgradePath: ["blade", "blade"] },
    { strategyId: "B", upgradePath: ["blade", "core"] },
    { strategyId: "C", upgradePath: ["core", "blade"] },
    { strategyId: "D", upgradePath: ["armor", "armor"] },
    { strategyId: "E", upgradePath: ["armor", "armor"] },
    { strategyId: "F", upgradePath: ["armor", "blade"] },
  ] as const)("independently replays all actions and statistics for $strategyId", scenario => {
    const run = runChallengeDiagnostics(scenario);
    const before = structuredClone(run);
    expect(() => verifyChallengeTrace(run)).not.toThrow(); expect(run).toEqual(before);
    expect(() => challengeDiagnosticsJson([run], "representative")).not.toThrow();
  });
  it.each([
    { label: "synchronized damage totals", edit: (r: ChallengeDiagnostics) => {
      for (const k of ["totalDamageTaken", "rawHpLossTaken"] as const) {
        Object.assign(r.battles[0].summary, { [k]: r.battles[0].summary[k] + 7 });
        Object.assign(r.summary, { [k]: r.summary[k] + 7 });
      }
    } },
    { label: "action classification counts", edit: (r: ChallengeDiagnostics) => {
      Object.assign(r.battles[0].summary, { attackCount: 100 }); Object.assign(r.summary, { attackCount: 100 });
    } },
    { label: "enemy and Boss special counts", edit: (r: ChallengeDiagnostics) => {
      for (const k of ["enemyAttacks", "bossSpecialAttacks"] as const) {
        Object.assign(r.battles[2].summary, { [k]: r.battles[2].summary[k] + 100 });
        Object.assign(r.summary, { [k]: r.summary[k] + 100 });
      }
    } },
    { label: "E mislabeled A", edit: (r: ChallengeDiagnostics) => {
      Object.assign(r.scenario, { strategyId: "A" }); for (const b of r.battles) Object.assign(b.summary, { strategyId: "A" });
    } },
    { label: "synchronized Heavy entry energy", edit: (r: ChallengeDiagnostics) => {
      Object.assign(r.battles[1].initialState.player, { energy: 3 }); Object.assign(r.battles[1].actions[0].before.player, { energy: 3 });
      Object.assign(r.upgrades[0].after.player, { energy: 3 }); Object.assign(r.battles[1].summary, { initialEnergy: 3 });
    } },
    { label: "executed intent removed", edit: (r: ChallengeDiagnostics) => {
      Object.assign(r.battles[0].actions[0].effects!, { enemyIntent: null });
    } },
  ])("rejects historical counterexample: $label", ({ edit }) => {
    const run = structuredClone(win); edit(run);
    expect(() => verifyChallengeTrace(run)).toThrow(TypeError);
    expect(() => challengeDiagnosticsJson([run], "representative")).toThrow(TypeError);
    expect(() => challengeDiagnosticsCsv([run])).toThrow(TypeError);
  });
  it.each(["overkillDamageTaken", "overkillDamageDealt", "rawHpLossDealt", "totalDamageDealt", "defendCount", "bossNormalAttacks", "actionAttempts", "playerActions"] as const)("rejects corrupted %s", key => {
    const run = structuredClone(win);
    Object.assign(run.battles[2].summary, { [key]: run.battles[2].summary[key] + 1 });
    Object.assign(run.summary, { [key]: run.summary[key] + 1 });
    expect(() => verifyChallengeTrace(run)).toThrow();
  });
  it.each(["hp", "energyCap", "upgrades"] as const)("rejects synchronized upgrade %s corruption", key => {
    const run = structuredClone(win), value = key === "upgrades" ? { blade: 9, core: 9, armor: 9 } : 999;
    Object.assign(run.upgrades[0].after.player, { [key]: value });
    Object.assign(run.battles[1].initialState.player, { [key]: value });
    Object.assign(run.battles[1].actions[0].before.player, { [key]: value });
    expect(() => verifyChallengeTrace(run)).toThrow();
  });
  it("retains raw errors and refuses them as completed experiments", () => {
    const error = runChallengeDiagnostics({ strategyId: "A", upgradePath: ["blade", "blade"] }, { chooseAction: () => { throw new Error("policy failed"); } });
    const inspection = inspectChallengeTrace(error);
    expect(inspection.valid).toBe(false);
    if (inspection.valid) throw new Error("expected failed verification");
    expect(inspection.raw).toBe(error); expect(inspection.reason).toContain("policy failed");
    expect(() => challengeDiagnosticsJson([error], "representative")).toThrow(/Error result/);
    const invalid = structuredClone(error); Object.assign(invalid.battles[0].actions[0].after.player, { hp: NaN });
    expect(() => challengeDiagnosticsJson([invalid], "representative")).toThrow(/finite/);
    const raw = inspectChallengeTrace(invalid); if (raw.valid) throw new Error("expected invalid");
    expect(raw.raw).toBe(invalid); expect(Number.isNaN(raw.raw.battles[0].actions[0].after.player.hp)).toBe(true);
  });
  it("rejects custom policies mislabeled as registered policies", () => {
    const run = runChallengeDiagnostics({ strategyId: "A", upgradePath: ["armor", "armor"] }, {
      chooseAction: state => state.player.energy >= 2 ? "heavy" : "defend",
    });
    expect(() => verifyChallengeTrace(run)).toThrow(/action/);
  });
  it("validates terminal actions at the actual last allowed action", () => {
    const victory = runChallengeDiagnostics({ strategyId: "E", upgradePath: ["armor", "armor"] }, { maxActions: 13 });
    expect(victory.summary.outcome).toBe("victory"); expect(victory.battles[2].summary.playerActions).toBe(13);
    expect(() => verifyChallengeTrace(victory)).not.toThrow();
    const defeat = runChallengeDiagnostics({ strategyId: "C", upgradePath: ["core", "blade"] }, { maxActions: 6 });
    expect(defeat.summary.outcome).toBe("defeat"); expect(defeat.battles.at(-1)!.summary.playerActions).toBe(6);
    expect(() => verifyChallengeTrace(defeat)).not.toThrow();
  });
  it("rejects premature termination and missing transitions", () => {
    const run = structuredClone(win); Object.assign(run, { battles: run.battles.slice(0, 1), upgrades: [] });
    expect(() => verifyChallengeTrace(run)).toThrow(/missing next battle/);
    const premature = structuredClone(win); Object.assign(premature.battles[0], { actions: premature.battles[0].actions.slice(0, 1) });
    expect(() => verifyChallengeTrace(premature)).toThrow();
  });
});
