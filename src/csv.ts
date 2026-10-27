import { attributes, weapons } from './engine';
import type { forecast, skillTableForecast } from './forecast';
import { skillGroups, skillSets } from './skills';

export function csv(rows: (string | number)[][]) {
  return '\ufeff' + rows.map((row) => row.map((value) => `"${String(value).replace(/"/g, '""')}"`).join(',')).join('\r\n') + '\r\n';
}

export function bonusCsv(result: ReturnType<typeof forecast>) {
  return csv([
    ['再抽次数', '复原位置', '武器', '属性', '槽位1', '槽位2', '槽位3', '槽位4', '槽位5'],
    ...result.rows.map((row) => [row.counter - result.start + 1, row.counter, weapons[result.filter.weapon]!, attributes[result.filter.attribute]!, ...row.values]),
  ]);
}

export function skillCsv(result: ReturnType<typeof skillTableForecast>, vertical = false) {
  const rows = [
    ['再抽次数', ...result.columns.map((column) => column.counter - result.start + 1)],
    ['技能位置', ...result.columns.map((column) => column.counter)],
    ...result.filter.weapons.flatMap((weapon, i) => [
      [`${weapons[weapon.weapon]}·${attributes[weapon.attribute]} 系列技能`, ...result.columns.map((column) => skillSets[column.cells[i]!.set]!)],
      [`${weapons[weapon.weapon]}·${attributes[weapon.attribute]} 组合技能`, ...result.columns.map((column) => skillGroups[column.cells[i]!.group]!)],
    ]),
  ];
  return csv(vertical ? rows[0]!.map((_, i) => rows.map((row) => row[i]!)) : rows);
}
