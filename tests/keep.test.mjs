import { test } from 'bun:test';
import strict from 'node:assert/strict';
import { bonuses, predictKeep } from '../src/engine.ts';

test('Keep matches GogmaSeedFinder upstream six-roll formula vector', () => {
  // crates/rng-core/src/lib.rs: keep_rolls_preserve_each_slot_category_and_match_the_upstream_formula
  strict.deepEqual(predictKeep(86315169, 8, 1, 480, 6, [0, 1, 2, 3, 0]), [
    [8, 9, 11, 10, 12], [12, 9, 14, 6, 8], [15, 13, 11, 6, 15],
    [15, 13, 14, 10, 12], [8, 16, 11, 10, 8], [15, 16, 11, 6, 8],
  ]);
});

test('Keep preserves ordered categories across weapons, counters and repeated categories', () => {
  [0, 11, 12, 13].forEach((weapon) => {
    const layout = weapon === 11 ? [0, 1, 2, 0, 1] : [0, 1, 3, 0, 1];
    const rows = predictKeep(0xffffffff, weapon, 4, 0xffffff00, 100, layout);
    rows.forEach((row) => strict.deepEqual(row.map((id) => bonuses.find((b) => b.id === id).category), layout));
    strict.deepEqual(predictKeep(0xffffffff, weapon, 4, 0xffffff00 + 30, 1, layout)[0], rows[30]);
  });
});

test('Keep rejects incomplete, unavailable and exhausted category layouts', () => {
  strict.throws(() => predictKeep(1, 0, 1, 0, 1, [0, 1]));
  strict.throws(() => predictKeep(1, 11, 1, 0, 1, [0, 1, 2, 3, 0]));
  strict.throws(() => predictKeep(1, 12, 1, 0, 1, [0, 1, 2, 0, 0]));
  strict.throws(() => predictKeep(1, 0, 0, 0, 1, [0, 1, 2, 0, 0]));
  strict.throws(() => predictKeep(1, 0, 1, 0, 1, [2, 2, 2, 2, 2]));
  strict.throws(() => predictKeep(1, 0, 1, 0, 1, [3, 3, 3, 0, 0]));
  strict.throws(() => predictKeep(1, 0, 1, 0, 1, [0, 1, 2, 3, 4]));
});
