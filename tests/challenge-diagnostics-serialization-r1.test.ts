import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { CHALLENGE_SCENARIOS, runChallengeDiagnostics } from "../lib/simulation/run-challenge-diagnostics-r1";
import { CSV_COLUMNS, challengeDiagnosticsCsv, challengeDiagnosticsJson, createChallengeExperiment, implementationFingerprint, validateChallengeExperiment, validateScenarioCoverage } from "../lib/simulation/serialize-challenge-diagnostics-r1";

const victory = runChallengeDiagnostics({ strategyId: "E", upgradePath: ["armor", "armor"] });
const early = runChallengeDiagnostics({ strategyId: "A", upgradePath: ["blade", "blade"] }, { maxActions: 1 });
const csv = challengeDiagnosticsCsv([early]), json = challengeDiagnosticsJson([early], "representative");
describe("R1 independent serialization and manifest publication", () => {
  it("checks all 54 definitions, order and uniqueness without executing the full matrix", () => {
    expect(() => validateScenarioCoverage(structuredClone(CHALLENGE_SCENARIOS))).not.toThrow();
    expect(() => validateScenarioCoverage(CHALLENGE_SCENARIOS.slice(1))).toThrow();
    expect(() => validateScenarioCoverage([...CHALLENGE_SCENARIOS].reverse())).toThrow();
    expect(() => challengeDiagnosticsJson([victory])).toThrow(/54/);
    expect(() => challengeDiagnosticsJson(Array.from({ length: 54 }, () => early))).toThrow(/200/);
  });
  it("preserves deterministic CSV fields and 54 fixture rows, without claiming unique experiments", () => {
    const text = challengeDiagnosticsCsv(Array.from({ length: 54 }, () => early));
    expect(text.trimEnd().split("\n")).toHaveLength(55);
    expect(text.split("\n")[0].split(",")).toEqual(CSV_COLUMNS);
    expect(text).toBe(challengeDiagnosticsCsv(Array.from({ length: 54 }, () => early)));
    expect(text).not.toContain("\r"); expect(text.endsWith("\n")).toBe(true);
  });
  it("round-trips every trace, upgrade and final state with actual limits and source fingerprints", () => {
    const data = JSON.parse(challengeDiagnosticsJson([victory], "representative"));
    expect(data.results[0].battles).toEqual(victory.battles); expect(data.results[0].upgrades).toEqual(victory.upgrades);
    expect(data.results[0].finalChallengeState).toEqual({ encounter: 2, phase: "victory", battle: victory.battles[2].finalState });
    expect(data.implementation).toEqual(implementationFingerprint());
    expect(data.experimentSummary.playerActions).toBe(victory.summary.playerActions);
    expect(data.experimentSummary.victory).toBe(1);
    expect(JSON.parse(json).maxActionsPerBattle).toBe(1);
    expect(() => validateChallengeExperiment(data)).not.toThrow();
  });
  it("rejects mixed limits, duplicate IDs, missing and non-JSON values", () => {
    expect(() => challengeDiagnosticsJson([early, victory], "representative")).toThrow(/mixed/);
    expect(() => challengeDiagnosticsJson([victory, victory], "representative")).toThrow(/duplicate/);
    for (const extra of [undefined, Symbol("bad"), NaN, Infinity]) {
      const invalid = { ...early, extra };
      expect(() => challengeDiagnosticsJson([invalid], "representative")).toThrow(TypeError);
    }
    const cyclic = { ...early, extra: {} }; cyclic.extra = cyclic;
    expect(() => challengeDiagnosticsJson([cyclic], "representative")).toThrow(/circular/);
  });
  it("does not mutate input and emits identical bytes for reordered object keys", () => {
    const input = structuredClone(victory), before = structuredClone(input);
    const reordered = Object.fromEntries(Object.entries(input).reverse()) as typeof input;
    expect(challengeDiagnosticsJson([reordered], "representative")).toBe(challengeDiagnosticsJson([input], "representative"));
    const envelope = createChallengeExperiment([input], "representative");
    expect(() => validateChallengeExperiment(envelope)).not.toThrow();
    expect(input).toEqual(before); Object.assign(input.summary, { playerHp: 999 });
    expect(JSON.parse(JSON.stringify(envelope)).results[0].summary.playerHp).toBe(before.summary.playerHp);
  });
  it.each([
    { label: "empty results", edit: (d: Record<string, unknown>) => { d.results = []; } },
    { label: "empty scenarios", edit: (d: Record<string, unknown>) => { d.scenarios = []; } },
    { label: "incorrect implementation fingerprint", edit: (d: Record<string, unknown>) => { d.implementation = {}; } },
    { label: "incorrect configuration", edit: (d: Record<string, unknown>) => { d.config = {}; } },
    { label: "incorrect experiment totals", edit: (d: Record<string, unknown>) => { d.experimentSummary = {}; } },
  ])("rejects envelope: $label", ({ edit }) => {
    const data = JSON.parse(json); edit(data);
    expect(() => validateChallengeExperiment(data)).toThrow();
  });
  it.each([
    { label: "normal commit, independently verified manifest and exact fingerprints", body: `
      const result = writeR1Artifacts(root, csv, json); const dir = result.directory;
      assert.equal(result.state, 'committed'); assert.deepEqual(result.durabilityWarnings, []);
      const manifest = verifyR1Run(dir); assert.equal(manifest.status, 'committed');
      assert.equal(fs.statSync(dir).mode & 0o777, 0o700);
      assert.deepEqual(fs.readdirSync(dir).sort(), ['actions.json', 'manifest.json', 'results.csv']);
      assert.deepEqual(manifest.implementation, JSON.parse(json).implementation);
      for (const f of manifest.files) { const b=fs.readFileSync(path.join(dir,f.name)); assert.equal(f.size,b.length); assert.equal(f.sha256,hash(b)); }
    ` },
    { label: "JSON empty results with recomputed hash", body: `
      tamper('actions.json', bytes => { const d=JSON.parse(bytes); d.results=[]; return JSON.stringify(d); });
    ` },
    { label: "JSON empty scenarios with recomputed hash", body: `
      tamper('actions.json', bytes => { const d=JSON.parse(bytes); d.scenarios=[]; return JSON.stringify(d); });
    ` },
    { label: "hash-correct CSV not corresponding to JSON", body: `
      tamper('results.csv', () => csv.replace('blade-blade__A','blade-blade__B'));
    ` },
    { label: "hash-correct invalid CSV", body: `
      tamper('results.csv', () => 'not CSV');
    ` },
    { label: "hash-correct JSON with falsified statistics", body: `
      tamper('actions.json', bytes => { const d=JSON.parse(bytes),r=d.results[0];r.summary.attackCount++;r.battles[0].summary.attackCount++;return JSON.stringify(d); });
    ` },
    { label: "manifest wrong summary", body: `
      const r=writeR1Artifacts(root,csv,json); const p=path.join(r.directory,'manifest.json');
      const m=JSON.parse(fs.readFileSync(p));m.experimentSummary.playerActions++;fs.writeFileSync(p,JSON.stringify(m));
      assert.throws(()=>verifyR1Run(r.directory));
    ` },
    { label: "manifest write before open failure", body: `
      incomplete({ ...fs, openSync(p,...args){ if(path.basename(p)==='manifest.pending.json')throw Error('injected');return fs.openSync(p,...args); } }, /open manifest.pending.json/);
    ` },
    { label: "manifest partial write failure", body: `
      const names=new Map();
      incomplete({ ...fs,openSync(p,...a){const fd=fs.openSync(p,...a);names.set(fd,p);return fd;},writeFileSync(fd,b,...a){if(typeof fd==='number'&&names.get(fd).endsWith('manifest.pending.json')){fs.writeFileSync(fd,'partial');throw Error('injected');}return fs.writeFileSync(fd,b,...a);} }, /write manifest.pending.json/);
    ` },
    { label: "manifest fsync failure", body: `
      const names=new Map();
      incomplete({ ...fs,openSync(p,...a){const fd=fs.openSync(p,...a);names.set(fd,p);return fd;},fsyncSync(fd){if(names.get(fd).endsWith('manifest.pending.json'))throw Error('injected');fs.fsyncSync(fd);} }, /fsync manifest.pending.json/);
    ` },
    { label: "rename failure", body: `
      incomplete({ ...fs,renameSync(){throw Error('injected rename');} }, /rename manifest/);
    ` },
    { label: "post-rename directory fsync failure is committed warning", body: `
      const names=new Map();
      const io={...fs,openSync(p,...a){const fd=fs.openSync(p,...a);names.set(fd,p);return fd;},fsyncSync(fd){if(fs.statSync(names.get(fd)).isDirectory())throw Error('injected directory fsync');fs.fsyncSync(fd);}};
      const r=writeR1Artifacts(root,csv,json,io);assert.equal(r.state,'committed');assert.ok(r.durabilityWarnings.length);
      assert.ok(!fs.existsSync(path.join(r.directory,'failure.json')));verifyR1Run(r.directory);
    ` },
    { label: "failure marker write failure still cannot complete", body: `
      const io={...fs,renameSync(){throw Error('injected rename');},writeFileSync(p,b,...a){if(typeof p==='string'&&p.endsWith('failure.json'))throw Error('marker failure');return fs.writeFileSync(p,b,...a);}};
      incomplete(io,/Failure marker could not be written/);
    ` },
    { label: "manifest fsync plus failure-marker failure remains incomplete", body: `
      const names=new Map();
      const io={...fs,openSync(p,...a){const fd=fs.openSync(p,...a);names.set(fd,p);return fd;},fsyncSync(fd){if(names.get(fd).endsWith('manifest.pending.json'))throw Error('fsync failure');fs.fsyncSync(fd);},writeFileSync(p,b,...a){if(typeof p==='string'&&p.endsWith('failure.json'))throw Error('marker failure');return fs.writeFileSync(p,b,...a);}};
      incomplete(io,/Failure marker could not be written/);
    ` },
    { label: "rename succeeded but acknowledgement threw", body: `
      const r=writeR1Artifacts(root,csv,json,{...fs,renameSync(a,b){fs.renameSync(a,b);throw Error('lost acknowledgement');}});
      assert.equal(r.state,'committed');assert.ok(r.durabilityWarnings.length);verifyR1Run(r.directory);
      assert.ok(!fs.existsSync(path.join(r.directory,'failure.json')));
    ` },
    { label: "lost rename acknowledgement plus read failure is indeterminate, not incomplete", body: `
      let renamed=false;
      const io={...fs,renameSync(a,b){fs.renameSync(a,b);renamed=true;throw Error('lost acknowledgement');},readFileSync(p,...a){if(renamed&&path.basename(p)==='manifest.json')throw Error('temporary read failure');return fs.readFileSync(p,...a);}};
      const r=writeR1Artifacts(root,csv,json,io);assert.equal(r.state,'indeterminate');
      assert.ok(!fs.existsSync(path.join(r.directory,'failure.json')));verifyR1Run(r.directory);
    ` },
    { label: "completed run cannot be overwritten", body: `
      const id='00000000-0000-0000-0000-000000000001';const r=writeR1Artifacts(root,csv,json,fs,()=>id);
      const before=fs.readFileSync(path.join(r.directory,'manifest.json'));
      assert.throws(()=>writeR1Artifacts(root,csv,json,fs,()=>id),/create run directory/);
      assert.deepEqual(fs.readFileSync(path.join(r.directory,'manifest.json')),before);verifyR1Run(r.directory);
    ` },
    { label: "fstat failure retained as incomplete", body: `
      incomplete({...fs,fstatSync(){throw Error('injected fstat');}},/fstat results.csv/);
    ` },
    { label: "first data write failure", body: `
      incomplete({...fs,writeFileSync(p,b,...a){if(typeof p==='number')throw Error('injected data write');return fs.writeFileSync(p,b,...a);}},/write results.csv/);
    ` },
    { label: "second data write failure", body: `
      let count=0;incomplete({...fs,writeFileSync(p,b,...a){if(typeof p==='number'&&++count===2)throw Error('injected data write');return fs.writeFileSync(p,b,...a);}},/write actions.json/);
    ` },
    { label: "symlinked output directory", body: `
      fs.renameSync(parent,parent+'-real');fs.symlinkSync(parent+'-real',parent,'dir');assert.throws(()=>writeR1Artifacts(root,csv,json),/symlinked/);
    ` },
    { label: "missing file or manifest", body: `
      for(const name of ['results.csv','actions.json','manifest.json']){const r=writeR1Artifacts(root,csv,json);fs.unlinkSync(path.join(r.directory,name));assert.throws(()=>verifyR1Run(r.directory));}
    ` },
    { label: "wrong file size and hash", body: `
      for(const key of ['size','sha256']){const r=writeR1Artifacts(root,csv,json),p=path.join(r.directory,'manifest.json');const m=JSON.parse(fs.readFileSync(p));m.files[0][key]=key==='size'?0:'0'.repeat(64);fs.writeFileSync(p,JSON.stringify(m));assert.throws(()=>verifyR1Run(r.directory));}
    ` },
    { label: "full metadata with no results cannot be published", body: `
      const d=JSON.parse(json);d.coverage='full';d.maxActionsPerBattle=200;d.results=[];d.scenarios=[];
      assert.throws(()=>writeR1Artifacts(root,'garbage',JSON.stringify(d)),/incomplete/);
      for(const name of fs.readdirSync(parent))assert.throws(()=>verifyR1Run(path.join(parent,name)));
    ` },
  ])("publication state machine: $label", ({ body }) => {
    const temporary=mkdtempSync(path.join(tmpdir(),"ember-r1-commit-test-"));
    mkdirSync(path.join(temporary,"data/simulation"),{recursive:true});
    const script=new URL("../scripts/run-challenge-diagnostics-r1.mjs",import.meta.url).href;
    try {
      execFileSync(process.execPath,["--input-type=module","-e",`
        import * as fs from 'node:fs';import path from 'node:path';import assert from 'node:assert/strict';import {createHash} from 'node:crypto';
        import {writeR1Artifacts,verifyR1Run} from ${JSON.stringify(script)};
        const root=process.argv[1],csv=process.argv[2],json=process.argv[3],parent=path.join(root,'data/simulation');
        const hash=b=>createHash('sha256').update(b).digest('hex');
        function incomplete(io,pattern){let error;try{writeR1Artifacts(root,csv,json,io);}catch(e){error=e;}assert.ok(error);assert.equal(error.state,'incomplete');assert.match(error.message,pattern);assert.ok(error.runDirectory);assert.ok(!fs.existsSync(path.join(error.runDirectory,'manifest.json')));assert.throws(()=>verifyR1Run(error.runDirectory));return error.runDirectory;}
        function tamper(name,edit){const r=writeR1Artifacts(root,csv,json),p=path.join(r.directory,name);fs.writeFileSync(p,edit(fs.readFileSync(p,'utf8')));const mp=path.join(r.directory,'manifest.json'),m=JSON.parse(fs.readFileSync(mp));m.files=m.files.map(f=>{const b=fs.readFileSync(path.join(r.directory,f.name));return {...f,size:b.length,sha256:hash(b)};});fs.writeFileSync(mp,JSON.stringify(m));assert.throws(()=>verifyR1Run(r.directory));}
        ${body}
      `,temporary,csv,json],{encoding:"utf8",stdio:"pipe"});
    } finally { rmSync(temporary,{recursive:true,force:true}); }
  });
  it("keeps all nine historical asset SHA-256 values unchanged", () => {
    const expected: Record<string, string> = {
      "data/simulation/baseline-results.csv": "c2caf08f5e5f74679da37ad6ca9512e3c014585286fc9cfb78881c31f91e6abd",
      "data/simulation/baseline-actions.json": "8f67089be2579ea57e964c4cb2c05175b1ef97081524517343cbc248b75d8e42",
      "data/simulation/strategy-comparison-results.csv": "4f3cbbef2f60f917485c970ca4df5a0ee86f650a2306c74565df35b1ca0174e1",
      "data/simulation/strategy-comparison-actions.json": "6d25226df3525e183d3c0af893b8ce8ec58601ddaef87854036e122651031011",
      "data/simulation/boss-resource-comparison-results.csv": "30a491614fea9c7a3238d21960f1ae2853120006e5100c07ce9027e82fa63929",
      "data/simulation/boss-resource-comparison-actions.json": "e1fa733f600e5ab38c9b196203a867600331d5db1a504597fffe074e71d99b74",
      "docs/BALANCE_BASELINE.md": "f73c7934a01228ec557c43b4790baa7412376ff622f7e2ab2a914b04ed6be52b",
      "docs/STRATEGY_COMPARISON.md": "38ba0e3b7675ffa485abf693863619f5bdfa3ba248a09d874923d31e0e3380f5",
      "docs/BOSS_RESOURCE_COMPARISON.md": "31175b021ebf41025028872eb350a29ae815eb0e73b866f3339f5db080812bdf",
    };
    for (const [p, hash] of Object.entries(expected)) expect(createHash("sha256").update(readFileSync(p)).digest("hex")).toBe(hash);
  });
});
