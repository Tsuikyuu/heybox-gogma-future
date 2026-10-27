import { test } from 'bun:test';
import strict from 'node:assert/strict';
import ExcelJS from 'exceljs';
import { bonusExcel, skillExcel } from '../src/excel.ts';
import { forecast, skillTableForecast } from '../src/forecast.ts';
import { skillGroups, skillSets } from '../src/skills.ts';

const position = { seed: 8524433, counter: 480, skill: 186 };
const input = { weapons: [{ weapon: 10, attribute: 4 }, { weapon: 3, attribute: 1 }], count: 100, set: 19, group: 9 };

test('Excel roundtrip retains merged weapon headers, separate skills, all pages and highlights', async () => {
  const result = skillTableForecast(position, input);
  const book = new ExcelJS.Workbook();
  await book.xlsx.load(await skillExcel(result));
  const sheet = book.worksheets[0];
  strict.equal(sheet.rowCount, 102);
  strict.equal(sheet.columnCount, 6);
  strict.equal(sheet.getCell('D1').master.address, 'C1');
  strict.equal(sheet.getCell('F1').master.address, 'E1');
  strict.equal(sheet.getCell('A2').master.address, 'A1');
  strict.equal(sheet.getCell('C2').value, '系列技能');
  strict.equal(sheet.getCell('D2').value, '组合技能');
  strict.equal(sheet.getCell('A102').value, 100);
  strict.equal(sheet.getCell('B102').value, 285);
  strict.equal(sheet.views[0].ySplit, 2);
  strict.equal(sheet.views[0].xSplit, 2);
  result.columns.forEach((column, i) => column.cells.forEach((cell, j) => {
    strict.equal(sheet.getRow(i + 3).getCell(j * 2 + 3).value, skillSets[cell.set]);
    strict.equal(sheet.getRow(i + 3).getCell(j * 2 + 4).value, skillGroups[cell.group]);
    strict.equal(sheet.getRow(i + 3).getCell(j * 2 + 3).fill?.fgColor?.argb, cell.matches ? 'FFFCD34D' : undefined);
  }));
});

test('Excel exports filtered rows, honors disabled highlighting and supports empty results', async () => {
  const result = skillTableForecast(position, { ...input, filterMatches: true, highlight: false });
  const book = new ExcelJS.Workbook();
  await book.xlsx.load(await skillExcel(result));
  strict.equal(book.worksheets[0].rowCount, result.columns.length + 2);
  strict.equal(book.worksheets[0].getCell('C3').fill?.fgColor, undefined);
  const empty = new ExcelJS.Workbook();
  await empty.xlsx.load(await skillExcel({ ...result, columns: [] }));
  strict.equal(empty.worksheets[0].rowCount, 2);
});

test('bonus Excel exports all five slots and original counters beyond page one', async () => {
  const result = forecast(position, { mode: 'bonus', weapon: 0, attribute: 0, count: 100, requirements: [0, 0, 0, 0, 0], set: 0, group: 0 });
  const book = new ExcelJS.Workbook();
  await book.xlsx.load(await bonusExcel(result));
  const sheet = book.worksheets[0];
  strict.equal(sheet.rowCount, 101);
  strict.equal(sheet.getCell('B101').value, 579);
  strict.deepEqual(sheet.getRow(101).values.slice(5), result.rows[99].values);
  strict.equal(sheet.views[0].ySplit, 1);
});
