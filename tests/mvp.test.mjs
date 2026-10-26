import { test } from 'node:test';
import { strict } from 'node:assert';
import { compile, compileRequirements, createSearch, predict } from '../src/engine.ts';
import { advance, align, archiveSchema, canUndoCount, correctLastRecord, deleteProfile, encodeCode, makeTask, newProfile, parseCode, restoreCheckpoint, saveCheckpoint, setCounter, undoCount, useCandidate, verifySample } from '../src/model.ts';
import { runSearch, searchProgress } from '../src/search.ts';
import { shortestRoute } from '../src/planner.ts';

const reference = await import('../experiments/gogma-js/core.mjs');
// Upstream independent Heavy Bowgun live fixture, commit 65789e9.
const rolls = [[13, 6, 8, 12, 6], [13, 10, 12, 15, 6], [9, 15, 9, 16, 6], [12, 16, 6, 8, 9], [12, 13, 15, 6, 9], [15, 9, 6, 16, 12]];
const setup = () => ({ ...newProfile('验证档案', 12, 3), gate: true, rolls });

test('legacy gate flags do not block searching or aligning a known position', () => {
  const p = { ...setup(), gate: false };
  const task = makeTask(p, { seedStart: 86315169, seedEnd: 86315169, counterStart: 480, counterEnd: 480 });
  strict.equal(task.seedStart, 86315169);
  const state = { seed: 86315169, counter: 480, skill: null };
  const aligned = align({ ...p, state, baseline: state }, false);
  strict.equal(aligned.aligned, true);
  strict.deepEqual(archiveSchema.parse({ version: 1, profiles: [aligned], active: aligned.id }).profiles[0], aligned);
});

test('legacy weapon parameters migrate into sampling metadata without binding the archive', () => {
  const legacy = { ...setup(), weapon: 12, attribute: 3 };
  delete legacy.sampling;
  const p = archiveSchema.parse({ version: 1, profiles: [legacy], active: legacy.id }).profiles[0];
  strict.deepEqual(p.sampling, { weapon: 12, attribute: 3 });
  strict.equal('weapon' in p, false);
  strict.equal('attribute' in p, false);
  strict.deepEqual(p.rolls, rolls);
  const task = makeTask(p, { seedStart: 86315169, seedEnd: 86315169, counterStart: 480, counterEnd: 480 });
  strict.equal(task.weapon, 12);
  strict.equal(task.attribute, 3);
  strict.deepEqual(createSearch(task.weapon, task.attribute, 480, 480, p.rolls)(86315169, 86315169), [{ seed: 86315169, counter: 480 }]);
  strict.deepEqual(archiveSchema.parse(JSON.parse(JSON.stringify({ version: 1, profiles: [p], active: p.id }))).profiles[0], p);
  strict.equal('weapon' in newProfile('仅种子档案'), false);
});

test('archive deletion keeps a valid active profile and supports deleting the last profile', () => {
  const a = setup(); const b = setup();
  const archive = { version: 1, profiles: [a, b], active: a.id };
  strict.equal(deleteProfile(archive, b.id).active, a.id);
  const remaining = deleteProfile(archive, a.id);
  strict.equal(remaining.active, b.id);
  strict.deepEqual(remaining.profiles, [b]);
  strict.deepEqual(deleteProfile(remaining, b.id), { version: 1, profiles: [], active: null });
  strict.equal(archive.profiles.length, 2);
  strict.deepEqual(archiveSchema.parse(remaining), remaining);
});

test('manual counter edits preserve seed, skill and saved state and validate input', () => {
  const p = saveCheckpoint({ ...setup(), aligned: true, state: { seed: 86315169, counter: 480, skill: 77 } });
  const next = setCounter(p, 490);
  strict.deepEqual(next.state, { seed: 86315169, counter: 490, skill: 77 });
  strict.deepEqual(next.checkpoint, p.checkpoint);
  strict.deepEqual(next.rolls, p.rolls);
  strict.deepEqual(next.demands, p.demands);
  strict.equal(next.logs.at(-1).before, 480);
  strict.equal(next.logs.at(-1).after, 490);
  strict.equal(canUndoCount(next), false);
  strict.equal(setCounter(next, 490), next);
  strict.equal(setCounter(next, 0).state.counter, 0);
  for (const count of [-1, 1.5, NaN, 0x100000000]) strict.throws(() => setCounter(p, count));
  strict.throws(() => setCounter(setup(), 1));
});

test('one-click count and undo preserve alignment and stop at targets and checkpoints', () => {
  const p = { ...setup(), aligned: true, state: { seed: 86315169, counter: 480, skill: 77 }, targets: [{ id: 't', name: '目标', weapon: 12, attribute: 3, counter: 481, roll: rolls[1] }] };
  strict.equal(canUndoCount(p), false);
  const counted = advance(p, 1, 'padding');
  strict.equal(counted.state.counter, 481);
  strict.equal(canUndoCount(counted), true);
  strict.throws(() => advance(counted, 1, 'padding'));
  const undone = undoCount(counted);
  strict.equal(undone.state.counter, 480);
  strict.equal(undone.state.skill, 77);
  strict.equal(undone.aligned, true);
  strict.equal(canUndoCount(undone), false);
  strict.throws(() => undoCount(undone));
  strict.equal(advance(undone, 1, 'padding').state.counter, 481);
  strict.equal(canUndoCount(saveCheckpoint(counted)), false);
  strict.equal(canUndoCount(advance(counted, 1, 'accepted')), false);
});

test('saved demands migrate old archives and survive backup round trips', () => {
  const old = setup();
  delete old.demands;
  strict.deepEqual(archiveSchema.parse({ version: 1, active: old.id, profiles: [old] }).profiles[0].demands, []);
  const p = { ...setup(), demands: [{ id: 'a', name: '冰属性重弩', weapon: 12, attribute: 3, requirements: [8, 8, 0, 0, 0], achieved: false }] };
  strict.deepEqual(archiveSchema.parse(JSON.parse(JSON.stringify({ version: 1, active: p.id, profiles: [p] }))).profiles[0].demands, p.demands);
  strict.throws(() => archiveSchema.parse({ version: 1, active: p.id, profiles: [{ ...p, demands: [{ ...p.demands[0], requirements: [999, 0, 0, 0, 0] }] }] }));
});

test('shortest route reassigns shared positions rather than greedily blocking a demand', () => {
  const demands = [
    { id: 'any', name: '任意重弩', weapon: 12, attribute: 3, requirements: [0, 0, 0, 0, 0], achieved: false },
    { id: 'specific', name: '指定重弩', weapon: 12, attribute: 3, requirements: rolls[0], achieved: false },
  ];
  const route = shortestRoute({ seed: 86315169, counter: 480, skill: null }, demands, 2);
  strict.equal(route.complete, true);
  strict.equal(route.total, 2);
  strict.deepEqual(route.steps.map((s) => [s.demand.id, s.counter, s.padding]), [['specific', 480, 0], ['any', 481, 0]]);
  strict.equal(shortestRoute({ seed: 86315169, counter: 480, skill: null }, demands, 1).complete, false);
  strict.equal(shortestRoute({ seed: 1, counter: 0xffffffff, skill: null }, demands).complete, false);
});

test('route total matches exhaustive assignments across different weapons and duplicate demands', () => {
  const position = { seed: 86315169, counter: 480, skill: null };
  const templates = [
    { weapon: 12, attribute: 3, requirements: [9, 9, 0, 0, 0] },
    { weapon: 0, attribute: 5, requirements: [8, 8, 0, 0, 0] },
    { weapon: 13, attribute: 7, requirements: [0, 0, 0, 0, 0] },
  ];
  for (let variant = 0; variant < 9; variant++) {
    const demands = [templates[variant % 3], templates[Math.floor(variant / 3)], templates[2]].map((d, i) => ({ ...d, id: String(i), name: String(i), achieved: false }));
    const candidates = demands.map((d) => predict(position.seed, d.weapon, d.attribute, position.counter, 8).flatMap((roll, offset) => compileRequirements(d.requirements)(roll) ? [offset] : []));
    const totals = candidates[0].flatMap((a) => candidates[1].flatMap((b) => candidates[2].filter((c) => a !== b && b !== c && a !== c).map((c) => Math.max(a, b, c) + 1)));
    const route = shortestRoute(position, demands, 8);
    strict.equal(route.complete, totals.length > 0);
    if (!totals.length) continue;
    strict.equal(route.total, Math.min(...totals));
    strict.equal(new Set(route.steps.map((s) => s.counter)).size, demands.length);
    strict.equal(route.steps.reduce((sum, s) => sum + s.padding + 1, 0), route.total);
    route.steps.forEach((s) => strict.equal(compileRequirements(s.demand.requirements)(s.roll), true));
  }
});

test('acquired demands follow execution, correction and game checkpoints', () => {
  const p = { ...setup(), aligned: true, state: { seed: 86315169, counter: 480, skill: null }, demands: [{ id: 'd', name: '重弩', weapon: 12, attribute: 3, requirements: rolls[0], achieved: false }], targets: [{ id: 't', demandId: 'd', name: '重弩', weapon: 12, attribute: 3, counter: 480, roll: rolls[0] }] };
  const accepted = advance(saveCheckpoint(p), 1, 'accepted');
  strict.equal(accepted.demands[0].achieved, true);
  strict.equal(correctLastRecord(accepted).demands[0].achieved, false);
  strict.equal(restoreCheckpoint(accepted).demands[0].achieved, false);
  strict.equal(restoreCheckpoint(saveCheckpoint(accepted)).demands[0].achieved, true);
  strict.equal(advance(p, 1, 'rejected').demands[0].achieved, false);
});

test('optional requirements match equal or higher tiers within the same category', () => {
  strict.equal(compileRequirements([0, 0, 0, 0, 0])(rolls[0]), true);
  for (const [lower, higher] of [[8, 12], [8, 15], [12, 15], [9, 13], [9, 16], [13, 16], [11, 14], [6, 10]]) {
    strict.equal(compileRequirements([lower])([higher]), true);
    strict.equal(compileRequirements([higher])([lower]), false);
    strict.equal(compileRequirements([higher])([higher]), true);
  }
  strict.equal(compileRequirements([8])([16, 14, 10]), false);
  strict.throws(() => compileRequirements([999]));
});

test('tier matching reserves higher slots and never counts one slot twice', () => {
  strict.equal(compileRequirements([8, 15])([15, 8]), true);
  strict.equal(compileRequirements([15, 8])([8, 15]), true);
  strict.equal(compileRequirements([8, 8])([15, 9, 6, 6, 13]), false);
  strict.equal(compileRequirements([8, 8])([12, 15, 6, 6, 13]), true);
  strict.equal(compileRequirements([15, 15])([15, 12]), false);
  strict.equal(compileRequirements([8, 9, 6, 8, 0])([10, 15, 13, 12, 6]), true);
});

test('Reset reproduces upstream live fixture and recovers unique seed / position', () => {
  strict.deepEqual(predict(86315169, 12, 3, 480, 6), rolls);
  strict.deepEqual(createSearch(12, 3, 475, 485, rolls)(86315069, 86315269), [{ seed: 86315169, counter: 480 }]);
});

test('TS port matches previously WASM-validated prototype across 126 weapon / attribute / seed cases', () => {
  for (let weapon = 0; weapon < 14; weapon++) {
    for (const attribute of [0, 3, 4]) {
      for (const seed of [0, 86315169, 0xffffffff]) {
        const counter = weapon * 193 + 480;
        const output = predict(seed, weapon, attribute, counter, 30);
        strict.deepEqual(output.flat(), [...reference.predict(seed, weapon, attribute, counter, 30)]);
        const start = Math.max(0, seed - 3);
        const end = Math.min(0xffffffff, seed + 3);
        const candidates = createSearch(weapon, attribute, counter - 3, counter + 3, output.slice(0, 6))(start, end);
        strict.deepEqual(candidates.flatMap((c) => [c.seed, c.counter]), reference.createSearch(weapon, attribute, counter - 3, counter + 3, output.slice(0, 6))(start, end));
      }
    }
  }
});

test('illegal pool entries, repeated EX slots and category limits fail at observation boundary', () => {
  strict.throws(() => compile(11, 3, [[6, 8, 9, 12, 13]]));
  strict.throws(() => compile(12, 3, [[11, 8, 9, 12, 13]]));
  strict.throws(() => compile(0, 0, [[11, 8, 9, 12, 13]]));
  strict.throws(() => compile(0, 3, [[15, 15, 15, 9, 13]]));
  strict.throws(() => compile(0, 3, [[6, 10, 6, 9, 13]]));
});

test('codes preserve unknown versus zero skill position and reject invalid integers', () => {
  strict.equal(parseCode('GSF1-0-480').skill, null);
  strict.equal(encodeCode(parseCode('GSF2-B0-G480-S0')), 'GSF2-B0-G480-S0');
  strict.equal(encodeCode(parseCode(' GSF1-4294967295-480 ')), 'GSF1-4294967295-480');
  for (const code of ['GSF1-1--1', 'GSF1-4294967296-1', 'GSF1-1-1.5', 'GSF2-BNaN-G0-S0', 'GSF1-1-1junk']) strict.throws(() => parseCode(code));
});

test('pause / serialized resume across counter tiles matches uninterrupted complete search', async () => {
  const task = makeTask(setup(), { seedStart: 86314969, seedEnd: 86315369, counterStart: 450, counterEnd: 520 });
  let batches = 0;
  const paused = await runSearch(task, { stopped: () => batches >= 3, progress: () => batches++, save: async () => {} });
  strict.equal(paused.status, 'paused');
  strict.ok(searchProgress(paused).percent > 0 && searchProgress(paused).percent < 100);
  const restored = archiveSchema.parse({ version: 1, active: null, profiles: [{ ...setup(), tasks: [JSON.parse(JSON.stringify(paused))] }] }).profiles[0].tasks[0];
  const resumed = await runSearch(restored, { stopped: () => false, progress: () => {}, save: async () => {} });
  strict.equal(resumed.status, 'complete');
  strict.equal(searchProgress(resumed).percent, 100);
  strict.deepEqual(resumed.candidates, createSearch(12, 3, 450, 520, rolls)(86314969, 86315369));
});

test('failed persistence aborts search and does not claim completion', async () => {
  const task = makeTask(setup(), { seedStart: 86315169, seedEnd: 86315169, counterStart: 480, counterEnd: 480 });
  await strict.rejects(runSearch(task, { stopped: () => false, progress: () => {}, save: async () => { throw new Error('quota'); } }), /quota/);
  strict.equal(task.status, 'paused');
  strict.equal(task.nextSeed, 86315169);
});

test('new player: identify, validate, rewind, pad, accept, save and resume without changing skill track', async () => {
  const p = { ...setup(), state: { seed: 86315169, counter: 480, skill: 77 } };
  const task = await runSearch(makeTask(p, { seedStart: 86315169, seedEnd: 86315169, counterStart: 480, counterEnd: 480 }), { stopped: () => false, progress: () => {}, save: async () => {} });
  const candidate = useCandidate(p, task, 0);
  strict.equal(candidate.aligned, false);
  strict.equal(candidate.calibrated, false);
  const verified = verifySample(candidate, predict(86315169, 12, 3, 486, 1)[0]);
  strict.equal(verified.calibrated, true);
  strict.equal(align(verified, true).state.counter, 487);
  const aligned = align(verified, false);
  const planned = { ...aligned, targets: [{ id: 'target', name: '重弩 A', weapon: 12, attribute: 3, counter: 483, roll: predict(86315169, 12, 3, 483, 1)[0] }] };
  strict.throws(() => advance(planned, 4, 'padding'));
  const padded = advance(planned, 3, 'padding');
  strict.equal(padded.state.counter, 483);
  const accepted = advance(padded, 1, 'accepted');
  strict.equal(accepted.state.counter, 484);
  strict.equal(accepted.state.skill, 77);
  const saved = saveCheckpoint(accepted);
  strict.equal(encodeCode(saved.checkpoint.position), 'GSF2-B86315169-G484-S77');
  strict.equal(restoreCheckpoint(advance(saved, 2, 'padding')).state.counter, 484);
  strict.deepEqual(archiveSchema.parse({ version: 1, profiles: [saved], active: saved.id }).profiles[0], saved);
});

test('conflicting targets block acceptance; rejected candidates still advance; mismatch pauses execution', () => {
  const p = { ...setup(), aligned: true, state: { seed: 86315169, counter: 480, skill: null }, targets: [{ id: 'a', name: 'A', counter: 480, weapon: 12, attribute: 3, roll: rolls[0] }] };
  strict.throws(() => advance({ ...p, targets: [...p.targets, { ...p.targets[0], id: 'b' }] }, 1, 'accepted'));
  strict.equal(advance(p, 1, 'rejected').state.counter, 481);
  const mismatch = advance(p, 1, 'mismatch');
  strict.equal(mismatch.aligned, false);
  strict.equal(mismatch.state.counter, 481);
  strict.throws(() => advance(mismatch, 1, 'padding'));
});

test('backup and search boundaries reject incompatible versions, corrupt cursors and invalid observations', () => {
  strict.throws(() => archiveSchema.parse({ version: 2, profiles: [], active: null }));
  strict.throws(() => makeTask(setup(), { seedStart: 10, seedEnd: 1, counterStart: 0, counterEnd: 1 }));
  strict.throws(() => makeTask(setup(), { seedStart: 0, seedEnd: 1, counterStart: 0, counterEnd: 10000 }));
  strict.throws(() => archiveSchema.parse({ version: 1, active: null, profiles: [{ ...setup(), rolls: [[8]] }] }));
});

test('tool-only correction retains audit history and requires realignment', () => {
  const p = { ...setup(), aligned: true, state: { seed: 86315169, counter: 480, skill: 77 } };
  const advanced = advance(p, 3, 'padding');
  const corrected = correctLastRecord(advanced);
  strict.equal(corrected.state.counter, 480);
  strict.equal(corrected.state.skill, 77);
  strict.equal(corrected.aligned, false);
  strict.equal(corrected.logs.length, 2);
  strict.throws(() => correctLastRecord(saveCheckpoint(advanced)));
});

test('identification after editing samples preserves imported skill position only for the same seed', () => {
  const p = { ...setup(), seedHint: 86315169, skillHint: 99 };
  const task = { ...makeTask(p, { seedStart: 86315169, seedEnd: 86315169, counterStart: 480, counterEnd: 480 }), status: 'complete', candidates: [{ seed: 86315169, counter: 480 }] };
  strict.equal(useCandidate(p, task, 0).state.skill, 99);
  strict.equal(useCandidate({ ...p, seedHint: 123 }, task, 0).state.skill, null);
});
