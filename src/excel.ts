import ExcelJS from 'exceljs';
import type { forecast, skillTableForecast } from './forecast';
import { attributes, weapons } from './engine';
import { skillGroups, skillSets } from './skills';

export async function bonusExcel(result: ReturnType<typeof forecast>) {
  const book = new ExcelJS.Workbook();
  const sheet = book.addWorksheet(result.filter.operation === 'keep' ? '不重置预测' : '复原预测');
  sheet.addRow(['再抽次数', '复原位置', '武器', '属性', '槽位1', '槽位2', '槽位3', '槽位4', '槽位5']);
  result.rows.forEach((row) => sheet.addRow([row.counter - result.start + 1, row.counter, weapons[result.filter.weapon], attributes[result.filter.attribute], ...row.values]));
  return finish(book, sheet, 1);
}

export async function skillExcel(result: ReturnType<typeof skillTableForecast>) {
  const book = new ExcelJS.Workbook();
  const sheet = book.addWorksheet('技能预测');
  sheet.addRow(['再抽次数', '技能位置', ...result.filter.weapons.flatMap((w) => [`${weapons[w.weapon]}·${attributes[w.attribute]}`, ''])]);
  sheet.addRow(['', '', ...result.filter.weapons.flatMap(() => ['系列技能', '组合技能'])]);
  sheet.mergeCells('A1:A2');
  sheet.mergeCells('B1:B2');
  result.filter.weapons.forEach((_, i) => sheet.mergeCells(1, i * 2 + 3, 1, i * 2 + 4));
  result.columns.forEach((column) => {
    const row = sheet.addRow([column.counter - result.start + 1, column.counter, ...column.cells.flatMap((cell) => [skillSets[cell.set], skillGroups[cell.group]])]);
    if (!result.filter.highlight) return;
    column.cells.forEach((cell, i) => {
      if (!cell.matches) return;
      [i * 2 + 3, i * 2 + 4].forEach((index) => {
        row.getCell(index).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFCD34D' } };
        row.getCell(index).font = { bold: true, color: { argb: 'FF78350F' } };
      });
    });
  });
  return finish(book, sheet, 2);
}

async function finish(book: ExcelJS.Workbook, sheet: ExcelJS.Worksheet, headers: number) {
  sheet.views = [{ state: 'frozen', xSplit: 2, ySplit: headers }];
  sheet.columns.forEach((column, i) => { column.width = i < 2 ? 12 : 22; });
  Array.from({ length: headers }, (_, i) => sheet.getRow(i + 1)).forEach((row) => {
    row.height = 26;
    row.eachCell((cell) => {
      cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF334155' } };
      cell.alignment = { vertical: 'middle', horizontal: 'center' };
    });
  });
  return new Uint8Array(await book.xlsx.writeBuffer());
}
