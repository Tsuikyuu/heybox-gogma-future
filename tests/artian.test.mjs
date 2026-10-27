import { test } from 'bun:test';
import strict from 'node:assert/strict';
import { predictArtian } from '../src/engine.ts';
import { alignArtianCounter, artianState, editArtianSample, recordArtianSample, searchArtianCounter, setArtianCounter, setArtianSampling, startArtianSampling } from '../src/artian.ts';
import { newProfile, profileSchema } from '../src/model.ts';

test('ordinary R8 predictions match upstream live vectors across all pool types', () => {
  // GogmaSeedFinder 65789e9: artian_base_{lance,multitype}_live_2026-10-11.json.
  [
    [0, 1, 0, [7, 4, 6, 7, 8]], [0, 1, 1, [6, 7, 4, 4, 6]],
    [0, 0, 2, [8, 7, 7, 8, 4]], [0, 0, 3, [4, 8, 8, 7, 8]],
    [6, 1, 2, [8, 7, 8, 4, 8]], [6, 0, 2, [4, 7, 7, 4, 8]],
    [11, 1, 10, [4, 8, 4, 8, 4]], [11, 1, 11, [8, 8, 4, 6, 4]],
    [11, 0, 12, [4, 8, 8, 4, 4]], [12, 0, 2, [8, 7, 8, 7, 8]],
    [13, 0, 5, [7, 7, 4, 4, 4]],
  ].forEach(([weapon, attribute, counter, roll]) => strict.deepEqual(predictArtian(86315169, weapon, attribute, counter, 1)[0], roll));
  strict.deepEqual(predictArtian(86315169, 0, 1, 0, 2), [[7, 4, 6, 7, 8], [6, 7, 4, 4, 6]]);
  strict.deepEqual(predictArtian(86315169, 0, 1, 0, 20), predictArtian(86315169, 0, 9, 0, 20));
});

test('counter location, rollback alignment, independent weapon counters and archive round trip', () => {
  let p = { ...newProfile('普通机械'), seedHint: 86315169 };
  p = startArtianSampling(p, 0, 1);
  p = recordArtianSample(p, [7, 4, 6, 7, 8]);
  p = recordArtianSample(p, [6, 7, 4, 4, 6]);
  p = searchArtianCounter(p, 0, 100);
  strict.deepEqual(p.artian.session.search.candidates, [0]);
  strict.equal(alignArtianCounter(p, 0, false).artian.counters[0], 0);
  p = alignArtianCounter(p, 0, true);
  strict.equal(p.artian.session.synced, true);
  strict.throws(() => setArtianSampling(p, 0, 1));
  const nextWeapon = setArtianSampling(p, 1, 1);
  strict.deepEqual(nextWeapon.artian.session.rolls, []);
  strict.equal(nextWeapon.artian.session.weapon, 1);
  strict.equal(nextWeapon.artian.counters[0], 2);
  strict.equal(nextWeapon.artian.session.search, null);
  strict.equal(nextWeapon.artian.session.synced, false);
  strict.equal(searchArtianCounter(p, 0, 100).artian.session.synced, false);
  p = setArtianCounter(p, 11, 12);
  strict.deepEqual(p.artian.counters, { 0: 2, 11: 12 });
  strict.equal(p.state, null);
  strict.deepEqual(profileSchema.parse(JSON.parse(JSON.stringify(p))).artian, p.artian);
  strict.equal(recordArtianSample(p, null).artian.session.search, null);
  const edited = editArtianSample(p, 0, [4, 4, 4, 4, 4]);
  strict.deepEqual(edited.artian.session.rolls, [[4, 4, 4, 4, 4], [6, 7, 4, 4, 6]]);
  strict.equal(edited.artian.session.search, null);
  strict.deepEqual(edited.artian.counters, { 11: 12 });
  strict.throws(() => editArtianSample(p, 2, [4, 4, 4, 4, 4]));
  strict.throws(() => editArtianSample(p, 0, [7, 7, 7, 4, 4]));
  strict.deepEqual(artianState({ ...p, seedHint: 1 }).counters, {});
  strict.throws(() => alignArtianCounter(p, 99, false));
});

test('invalid pools, caps, search ranges and unknown positions are rejected', () => {
  const p = startArtianSampling({ ...newProfile('边界'), seedHint: 0 }, 11, 0);
  strict.throws(() => recordArtianSample(p, [4, 4, 4, 7, 8]));
  strict.throws(() => recordArtianSample(p, [8, 8, 8, 8, 4]));
  strict.throws(() => recordArtianSample(p, [4]));
  strict.throws(() => searchArtianCounter(p, 0, 9999));
  strict.throws(() => setArtianCounter(p, 0, 1000001));
  const samples = recordArtianSample(recordArtianSample(p, [4, 4, 4, 4, 4]), [4, 4, 4, 4, 4]);
  strict.throws(() => searchArtianCounter(samples, 0, 10000));
  strict.throws(() => searchArtianCounter(samples, 999999, 1000000));
  strict.throws(() => artianState(newProfile('无种子')));
  strict.equal(p.artian.counters[0], undefined);
  const legacy = newProfile('旧档案');
  delete legacy.artian;
  strict.equal(profileSchema.parse(legacy).artian, null);
});

test('changing ordinary sampling parameters preserves samples and searches the selected weapon', () => {
  let p = startArtianSampling({ ...newProfile('切换武器'), seedHint: 86315169 }, 1, 1);
  p = recordArtianSample(p, [7, 4, 6, 7, 8]);
  p = recordArtianSample(p, [6, 7, 4, 4, 6]);
  p = searchArtianCounter(p, 0, 9999);
  const changed = setArtianSampling(p, 0, 1);
  strict.deepEqual(changed.artian.session.rolls, p.artian.session.rolls);
  strict.equal(changed.artian.session.weapon, 0);
  strict.equal(changed.artian.session.attribute, 1);
  strict.equal(changed.artian.session.search, null);
  strict.deepEqual(searchArtianCounter(changed, 0, 9999).artian.session.search.candidates, [0]);
  strict.equal(setArtianSampling(changed, 0, 1), changed);
  strict.throws(() => setArtianSampling(changed, 11, 1));
  strict.equal(changed.artian.session.weapon, 0);
  strict.deepEqual(startArtianSampling(changed, 0, 1).artian.session.rolls, []);
});
