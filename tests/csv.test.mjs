import { test } from 'bun:test';
import strict from 'node:assert/strict';
import { bonusCsv, csv, skillCsv } from '../src/csv.ts';
import { forecast, skillTableForecast } from '../src/forecast.ts';
import { attributes, weapons } from '../src/engine.ts';
import { skillGroups, skillSets } from '../src/skills.ts';

test('CSV preserves Chinese, quotes, commas and multiline cells', () => {
  strict.equal(csv([['中文', 'a,"b"\nc', 3]]), '\ufeff"中文","a,""b""\nc","3"\r\n');
});

test('bonus export includes results beyond the first page and original offsets', () => {
  const result = forecast({ seed: 8524433, counter: 480, skill: 186 }, { mode: 'bonus', weapon: 0, attribute: 0, count: 100, requirements: [0, 0, 0, 0, 0], set: 0, group: 0 });
  const text = bonusCsv(result);
  strict.equal(text.split('\r\n').length, 102);
  strict.ok(text.includes('"100","579"'));
  strict.ok(bonusCsv({ ...result, rows: [result.rows[99]] }).includes('"100","579"'));
});

test('skill export keeps horizontal weapons and only currently included columns', () => {
  const result = skillTableForecast({ seed: 8524433, counter: 480, skill: 186 }, { weapons: [{ weapon: 10, attribute: 4 }, { weapon: 3, attribute: 1 }], count: 100, set: 19, group: 9, filterMatches: true });
  const text = skillCsv(result);
  strict.equal(text.split('\r\n').length, 7);
  strict.equal(text.split('\r\n')[1], ['技能位置', ...result.columns.map((c) => c.counter)].map((v) => `"${v}"`).join(','));
  strict.equal(skillCsv({ ...result, filter: { ...result.filter, highlight: false } }), text);
  strict.equal(skillCsv({ ...result, columns: [] }).split('\r\n').length, 7);
  result.filter.weapons.forEach((weapon, i) => {
    strict.equal(text.split('\r\n')[2 + i * 2], csv([[`${weapons[weapon.weapon]}·${attributes[weapon.attribute]} 系列技能`, ...result.columns.map((c) => skillSets[c.cells[i].set])]]).slice(1, -2));
    strict.equal(text.split('\r\n')[3 + i * 2], csv([[`${weapons[weapon.weapon]}·${attributes[weapon.attribute]} 组合技能`, ...result.columns.map((c) => skillGroups[c.cells[i].group])]]).slice(1, -2));
  });
  const vertical = skillCsv(result, true).slice(1).trimEnd().split('\r\n');
  strict.equal(vertical.length, result.columns.length + 1);
  strict.equal(vertical[0].split(',').length, 6);
  strict.ok(vertical[0].includes('系列技能'));
  result.columns.forEach((column, i) => {
    strict.equal(vertical[i + 1], csv([[column.counter - result.start + 1, column.counter, ...column.cells.flatMap((cell) => [skillSets[cell.set], skillGroups[cell.group]])]]).slice(1, -2));
  });
  strict.equal(skillCsv({ ...result, columns: [] }, true).split('\r\n').length, 2);
});
