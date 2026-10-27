import { test } from 'node:test';
import { strict } from 'node:assert';
import { forecast, skillTableForecast } from '../src/forecast.ts';
import { predictSkills } from '../src/engine.ts';

const filters = { mode: 'bonus', weapon: 12, attribute: 3, count: 6, requirements: [0, 0, 0, 0, 0], set: 0, group: 0 };
const position = { seed: 86315169, counter: 480, skill: 186 };

test('full forecast table preserves all slots and absolute positions when filtered', () => {
  const all = forecast(position, filters);
  strict.equal(all.rows.length, 6);
  strict.deepEqual(all.rows[0], { counter: 480, values: ['会心 III', '斩味／装填', '攻击 II', '攻击 III', '斩味／装填'] });
  const matched = forecast(position, { ...filters, requirements: [15, 0, 0, 0, 0] });
  strict.deepEqual(matched.rows.map((r) => r.counter), [481, 482, 484, 485]);
  strict.ok(matched.rows.every((r) => r.values.length === 5));
  strict.deepEqual(forecast(position, { ...filters, requirements: [15, 15, 15, 15, 15] }).rows, []);
});

test('skill table uses independent counter and exact series/group filters', () => {
  const input = { ...filters, mode: 'skill', weapon: 10, attribute: 4, count: 10 };
  const state = { seed: 8524433, counter: 480, skill: 186 };
  const all = forecast(state, input);
  strict.equal(all.start, 186);
  strict.deepEqual(all.rows[0], { counter: 186, values: ['暗黑骑士之证', '霸主的盛怒'] });
  strict.deepEqual(forecast(state, { ...input, set: 20, group: 10 }).rows, [all.rows[0]]);
  strict.equal(forecast(state, { ...input, set: 18 }).rows.length, 2);
  strict.equal(forecast(state, { ...input, group: 10 }).rows.length, 4);
  strict.deepEqual(forecast({ ...state, counter: 900 }, input).rows, all.rows);
});

test('Keep table follows upstream slots, shares the restoration counter and preserves filtered positions', () => {
  const input = { ...filters, weapon: 8, attribute: 1, operation: 'keep', layout: [0, 1, 2, 3, 0] };
  const result = forecast(position, input);
  strict.deepEqual(result.rows[0], { counter: 480, values: ['攻击 II', '会心 II', '属性 II', '斩味／装填 EX', '攻击 III'] });
  strict.deepEqual(forecast(position, { ...input, requirements: [15, 15, 0, 0, 0] }).rows.map((row) => row.counter), [482]);
  strict.deepEqual(forecast({ ...position, skill: null }, input).rows, result.rows);
  strict.deepEqual(forecast({ ...position, counter: 481 }, { ...input, count: 5 }).rows, result.rows.slice(1));
  strict.throws(() => forecast(position, { ...input, layout: undefined }));
  strict.throws(() => forecast(position, { ...input, layout: [0, 1] }));
  strict.throws(() => forecast(position, { ...input, weapon: 11 }));
  strict.throws(() => forecast(position, { ...input, attribute: 0 }));
});

test('table validates parameters, unknown skill counters and position limits', () => {
  strict.throws(() => forecast({ ...position, skill: null }, { ...filters, mode: 'skill' }));
  strict.equal(forecast({ ...position, skill: 0 }, { ...filters, mode: 'skill' }).start, 0);
  for (const input of [{ count: 0 }, { count: 10001 }, { weapon: 14 }, { attribute: 10 }, { set: 22 }, { group: 15 }, { requirements: [999, 0, 0, 0, 0] }]) {
    strict.throws(() => forecast(position, { ...filters, ...input }));
  }
  strict.equal(forecast({ ...position, counter: 0xfffffffe }, { ...filters, count: 1 }).rows[0].counter, 0xfffffffe);
  strict.throws(() => forecast({ ...position, counter: 0xfffffffe }, { ...filters, count: 2 }));
});

test('horizontal skill table aligns every weapon to the same absolute columns', () => {
  const state = { seed: 8524433, counter: 480, skill: 186 };
  const input = { weapons: [{ weapon: 10, attribute: 4 }, { weapon: 3, attribute: 1 }], count: 100, set: 0, group: 0 };
  const result = skillTableForecast(state, input);
  strict.equal(result.columns.length, 100);
  strict.deepEqual(result.columns[0].cells[0], { set: 19, group: 9, matches: false });
  input.weapons.forEach((weapon, i) => {
    const stream = predictSkills(state.seed, weapon.weapon, weapon.attribute, state.skill, input.count);
    result.columns.forEach((column, n) => {
      strict.equal(column.counter, state.skill + n);
      strict.equal(column.cells[i].set, stream[n].set);
      strict.equal(column.cells[i].group, stream[n].group);
    });
  });
  const matched = skillTableForecast(state, { ...input, set: 19, group: 9, filterMatches: true });
  strict.deepEqual(matched.columns.map((c) => c.counter), result.columns.filter((c) => c.cells.some((cell) => cell.set === 19 && cell.group === 9)).map((c) => c.counter));
  strict.ok(matched.columns.length > 0);
  strict.ok(matched.columns.every((c) => c.cells.length === 2));
  strict.ok(matched.columns.some((c) => c.cells.some((cell) => !cell.matches)));
  strict.deepEqual(skillTableForecast(state, input).columns, result.columns);
});

test('multi-weapon skill filters reject duplicates, empty lists and invalid ranges', () => {
  const input = { weapons: [{ weapon: 0, attribute: 0 }], count: 1, set: 0, group: 0 };
  strict.throws(() => skillTableForecast(position, { ...input, weapons: [] }));
  strict.throws(() => skillTableForecast(position, { ...input, weapons: [input.weapons[0], input.weapons[0]] }));
  const weapons = Array.from({ length: 140 }, (_, i) => ({ weapon: Math.floor(i / 10), attribute: i % 10 }));
  const all = skillTableForecast(position, { ...input, weapons });
  strict.equal(all.filter.weapons.length, 140);
  strict.equal(all.columns[0].cells.length, 140);
  strict.throws(() => skillTableForecast(position, { ...input, weapons: [...weapons, weapons[0]] }));
  strict.throws(() => skillTableForecast({ ...position, skill: null }, input));
  strict.throws(() => skillTableForecast({ ...position, skill: 0xffffffff }, input));
  strict.equal(skillTableForecast({ ...position, skill: 0 }, input).columns[0].counter, 0);
});

test('skill table separates matching, highlighting and column filtering', () => {
  const state = { seed: 8524433, counter: 480, skill: 186 };
  const input = { weapons: [{ weapon: 10, attribute: 4 }], count: 10, set: 19, group: 9 };
  const initial = skillTableForecast(state, input);
  strict.equal(initial.filter.highlight, true);
  strict.equal(initial.filter.filterMatches, false);
  strict.equal(initial.columns.length, 10);
  strict.equal(initial.matchingCount, 1);
  for (const highlight of [true, false]) {
    const all = skillTableForecast(state, { ...input, highlight, filterMatches: false });
    strict.equal(all.columns.length, 10);
    strict.equal(all.columns[0].cells[0].matches, true);
    strict.deepEqual(skillTableForecast(state, { ...input, highlight, filterMatches: true }).columns.map((c) => c.counter), [186]);
    strict.deepEqual(skillTableForecast(state, { ...input, highlight, filterMatches: true, operator: 'OR' }).columns.map((c) => c.counter), [186, 190, 192, 193]);
  }
  strict.deepEqual(skillTableForecast(state, { ...input, set: 0, filterMatches: true }).columns.map((c) => c.counter), [192]);
  strict.equal(skillTableForecast(state, { ...input, set: 0, group: 0, filterMatches: true }).columns.length, 0);
  strict.throws(() => skillTableForecast(state, { ...input, set: 21 }));
  strict.throws(() => skillTableForecast(state, { ...input, group: 14 }));
  strict.throws(() => skillTableForecast(state, { ...input, operator: 'XOR' }));
});
