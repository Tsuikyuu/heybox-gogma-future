import { test } from 'node:test';
import { strict } from 'node:assert';
import { predictSkills } from '../src/engine.ts';
import { advance, archiveSchema, encodeCode, newProfile, restoreCheckpoint, saveCheckpoint, setSkillCounter } from '../src/model.ts';
import { skillGroups, skillSets } from '../src/skills.ts';
import { align, alignSkillCounter, editSkillObservation, recordSkillSample, searchSkillCounter, selectSkillCandidate, startSkillSampling, verifySkillSample } from '../src/model.ts';

// GogmaSeedFinder 65789e9, tests/fixtures/skill_stream_v0.9.3.json.
// These are upstream formula vectors, not independently observed game rolls.
const cases = [
  [8524433, 10, 4, 186, [275, 255, 245, 243, 37, 58, 9, 191, 218, 88]],
  [0, 0, 0, 0, [168, 62, 276, 208, 38, 177, 16, 37, 181, 114]],
  [99999999, 13, 9, 12345, [125, 15, 121, 60, 118, 81, 92, 45, 176, 227]],
  // Below-threshold fixture ignores counter 999999, so its effective start is 0.
  [42424242, 6, 5, 0, [172, 267, 19, 256, 151, 63, 53, 87, 251, 110]],
];

test('skill prediction matches all 40 upstream golden rolls and table labels', () => {
  for (const [seed, weapon, attribute, counter, expected] of cases) {
    const rolls = predictSkills(seed, weapon, attribute, counter, expected.length);
    strict.deepEqual(rolls.map((r) => r.tableIndex), expected);
    strict.ok(rolls.every((r) => skillSets[r.set] && skillGroups[r.group]));
    strict.deepEqual(predictSkills(seed, weapon, attribute, counter + 5, 5), rolls.slice(5));
  }
  const first = predictSkills(8524433, 10, 4, 186, 1)[0];
  strict.equal(skillSets[first.set], '暗黑骑士之证');
  strict.equal(skillGroups[first.group], '霸主的盛怒');
  strict.equal(first.id, 295);
});

test('skill jump supports u32 positions and wrapping seed addition', () => {
  strict.deepEqual(predictSkills(0xffffffff, 13, 9, 123, 10), predictSkills(13008, 0, 0, 123, 10));
  strict.deepEqual(predictSkills(42, 6, 5, 0xfffffffe, 2)[1], predictSkills(42, 6, 5, 0xffffffff, 1)[0]);
});

test('skill position stays independent, survives backups and restores checkpoints', () => {
  const state = { seed: 8524433, counter: 480, skill: null };
  const p = { ...newProfile('技能'), state, baseline: state, gate: true, aligned: true };
  strict.equal(p.skillGate, false);
  const positioned = { ...setSkillCounter(p, 186), skillGate: true };
  const saved = saveCheckpoint(positioned);
  const next = setSkillCounter(saved, 196);
  strict.equal(next.state.counter, 480);
  strict.equal(next.baseline.skill, null);
  strict.equal(next.checkpoint.position.skill, 186);
  strict.equal(advance(next, 1, 'padding').state.skill, 196);
  strict.equal(encodeCode(next.state), 'GSF2-B8524433-G480-S196');
  strict.equal(restoreCheckpoint(next).state.skill, 186);
  strict.deepEqual(archiveSchema.parse(JSON.parse(JSON.stringify({ version: 1, profiles: [next], active: next.id }))).profiles[0], next);
  const legacy = { ...p };
  delete legacy.skillGate;
  strict.equal(archiveSchema.parse({ version: 1, profiles: [legacy], active: p.id }).profiles[0].skillGate, false);
  strict.equal(setSkillCounter(p, 0).state.skill, 0);
  for (const value of [-1, 1.5, NaN, 0x100000000]) strict.throws(() => setSkillCounter(p, value));
  strict.throws(() => setSkillCounter(newProfile('未知'), 0));
});

const sampling = () => {
  const state = { seed: 8524433, counter: 480, skill: null };
  return startSkillSampling({ ...newProfile('技能定位'), state, baseline: state, aligned: true, gate: true }, { weapon: 10, attribute: 4 });
};

test('golden skill samples locate, verify, persist and align either game position', () => {
  const p = [275, 255, 245, 243].reduce(recordSkillSample, sampling());
  strict.equal(p.state.skill, null);
  const found = searchSkillCounter(p, 0, 9999);
  strict.deepEqual(found.skillSession.search.candidates, [186]);
  strict.equal(found.state.counter, 480);
  const selected = selectSkillCandidate(found, 186);
  const unverified = alignSkillCounter(selected, true);
  strict.equal(unverified.state.skill, 190);
  strict.equal(unverified.skillSession.verified, false);
  strict.equal(unverified.skillSession.synced, true);
  strict.equal(alignSkillCounter(selected, false).state.skill, 186);
  strict.deepEqual(archiveSchema.parse({ version: 1, profiles: [unverified], active: unverified.id }).profiles[0], unverified);
  strict.throws(() => verifySkillSample(selected, 0));
  strict.equal(selected.skillSession.rolls.length, 4);
  const verified = verifySkillSample(selected, 37);
  strict.equal(verified.skillSession.rolls.length, 5);
  strict.throws(() => verifySkillSample(verified, 37));
  const restored = archiveSchema.parse(JSON.parse(JSON.stringify({ version: 1, profiles: [verified], active: verified.id }))).profiles[0];
  strict.deepEqual(restored, verified);
  strict.equal(alignSkillCounter(restored, false).state.skill, 186);
  const continued = alignSkillCounter(restored, true);
  strict.equal(continued.state.skill, 191);
  strict.equal(continued.state.counter, 480);
  strict.equal(align(continued, false).state.skill, 191);
  strict.throws(() => recordSkillSample(continued, 58));
  strict.throws(() => alignSkillCounter(continued, true));
  const edited = recordSkillSample(verified, null);
  strict.equal(edited.skillSession.search, null);
  strict.equal(edited.skillSession.verified, false);
  strict.equal(edited.skillSession.candidate, null);
  const corrected = editSkillObservation(verified, 1, 0);
  strict.deepEqual(corrected.skillSession.rolls, [275, 0, 245, 243, 37]);
  strict.equal(corrected.skillSession.search, null);
  strict.equal(corrected.skillSession.verified, false);
  strict.equal(corrected.skillSession.candidate, null);
  strict.deepEqual(corrected.state, verified.state);
  strict.throws(() => editSkillObservation(verified, 5, 0));
  strict.throws(() => editSkillObservation(verified, 0, 294));
  strict.throws(() => editSkillObservation(continued, 0, 0));
  strict.throws(() => startSkillSampling(continued, { weapon: 0, attribute: 0 }));
  strict.throws(() => startSkillSampling({ ...setSkillCounter(p, 0), skillGate: true }, { weapon: 0, attribute: 0 }));
  const changed = startSkillSampling(verified, { weapon: 0, attribute: 0 });
  strict.deepEqual(changed.skillSession.rolls, verified.skillSession.rolls);
  strict.equal(changed.skillSession.weapon, 0);
  strict.equal(changed.skillSession.attribute, 0);
  strict.equal(changed.skillSession.search, null);
  strict.equal(changed.skillSession.candidate, null);
  strict.equal(changed.skillSession.verified, false);
  strict.equal(startSkillSampling(verified, { weapon: 10, attribute: 4 }), verified);
  const restoredWeapon = startSkillSampling(changed, { weapon: 10, attribute: 4 });
  strict.deepEqual(searchSkillCounter(restoredWeapon, 0, 9999).skillSession.search.candidates, [186]);
});

test('skill search includes endpoints, rejects invalid ranges and stale seeds', () => {
  const p = [275, 255].reduce(recordSkillSample, sampling());
  strict.deepEqual(searchSkillCounter(p, 186, 186).skillSession.search.candidates, [186]);
  strict.deepEqual(searchSkillCounter(p, 187, 190).skillSession.search.candidates, []);
  for (const range of [[-1, 0], [10, 9], [0, 10000], [0xfffffffe, 0xffffffff]]) strict.throws(() => searchSkillCounter(p, ...range));
  strict.throws(() => searchSkillCounter(sampling(), 0, 100));
  strict.throws(() => searchSkillCounter({ ...p, state: { ...p.state, seed: 1 } }, 0, 100));
  strict.throws(() => selectSkillCandidate(searchSkillCounter(p, 186, 186), 187));
  strict.throws(() => recordSkillSample(p, 294));
  const invalid = selectSkillCandidate(searchSkillCounter(p, 186, 186), 186);
  invalid.skillSession.rolls[0] = 0;
  strict.throws(() => archiveSchema.parse({ version: 1, profiles: [invalid], active: invalid.id }));
});

test('ambiguous skill samples retain all candidates until more observations distinguish them', () => {
  const rolls = predictSkills(8524433, 10, 4, 0, 10000).map((r) => r.tableIndex);
  const seen = new Map();
  const duplicate = rolls.findIndex((id, i) => {
    if (i === rolls.length - 1) return false;
    const key = `${id}-${rolls[i + 1]}`;
    if (seen.has(key)) return true;
    seen.set(key, i);
    return false;
  });
  strict.ok(duplicate >= 0);
  const p = rolls.slice(duplicate, duplicate + 2).reduce(recordSkillSample, sampling());
  const found = searchSkillCounter(p, 0, 9998);
  strict.ok(found.skillSession.search.candidates.length > 1);
  strict.ok(found.skillSession.search.candidates.includes(duplicate));
  const more = recordSkillSample(found, rolls[duplicate + 2]);
  strict.equal(more.skillSession.search, null);
  const narrowed = searchSkillCounter(more, 0, 9997);
  strict.ok(narrowed.skillSession.search.candidates.includes(duplicate));
  strict.ok(narrowed.skillSession.search.candidates.length < found.skillSession.search.candidates.length);
});
