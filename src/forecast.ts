import { z } from 'zod';
import { bonuses, compileRequirements, predict, predictKeep, predictSkills } from './engine';
import { uint } from './model';
import type { Position } from './model';
import { skillGroups, skillSets } from './skills';

const filters = z.object({
  mode: z.enum(['bonus', 'skill']), weapon: uint.max(13), attribute: uint.max(9),
  operation: z.enum(['reset', 'keep']).default('reset'),
  layout: z.array(uint.max(3)).length(5).optional(),
  count: uint.min(1).max(10000), requirements: z.array(uint).length(5),
  set: uint.max(skillSets.length), group: uint.max(skillGroups.length),
});

export function forecast(position: Position, input: unknown) {
  const filter = filters.parse(input);
  const start = filter.mode === 'bonus' ? position.counter : position.skill;
  if (start === null) throw new Error('请先到技能观星中确定技能位置');
  if (start + filter.count > 0xffffffff) throw new Error('预测范围不可超出位置上限');
  const matches = compileRequirements(filter.requirements);
  if (filter.mode === 'bonus' && filter.operation === 'keep' && !filter.layout) throw new Error('请按顺序填写当前五槽类别');
  const rows = filter.mode === 'bonus'
    ? (filter.operation === 'keep'
      ? predictKeep(position.seed, filter.weapon, filter.attribute, start, filter.count, filter.layout!)
      : predict(position.seed, filter.weapon, filter.attribute, start, filter.count))
      .flatMap((roll, offset) => matches(roll) ? [{ counter: start + offset, values: roll.map((id) => bonuses.find((b) => b.id === id)!.name) }] : [])
    : predictSkills(position.seed, filter.weapon, filter.attribute, start, filter.count)
      .flatMap((roll, offset) => (!filter.set || roll.set === filter.set - 1) && (!filter.group || roll.group === filter.group - 1)
        ? [{ counter: start + offset, values: [skillSets[roll.set]!, skillGroups[roll.group]!] }] : []);
  return { filter, seed: position.seed, start, rows };
}

const skillTableFilters = z.object({
  weapons: z.array(z.object({ weapon: uint.max(13), attribute: uint.max(9) })).min(1).max(140),
  count: uint.min(1).max(10000), set: uint.max(skillSets.length - 1), group: uint.max(skillGroups.length - 1),
  operator: z.enum(['OR', 'AND']).default('AND'),
  highlight: z.boolean().default(true), filterMatches: z.boolean().default(false),
}).refine((input) => new Set(input.weapons.map((w) => `${w.weapon}-${w.attribute}`)).size === input.weapons.length, '该武器种类与属性已添加');

export function skillTableForecast(position: Pick<Position, 'seed' | 'skill'>, input: unknown) {
  const filter = skillTableFilters.parse(input);
  if (position.skill === null) throw new Error('请先到技能观星中确定技能位置');
  const start = position.skill;
  if (start + filter.count > 0xffffffff) throw new Error('预测范围不可超出技能位置上限');
  const streams = filter.weapons.map((w) => predictSkills(position.seed, w.weapon, w.attribute, start, filter.count));
  const columns = Array.from({ length: filter.count }, (_, offset) => {
    const cells = streams.map((stream) => {
      const roll = stream[offset]!;
      const set = roll.set === filter.set;
      const group = roll.group === filter.group;
      const matches = filter.operator === 'OR' ? set || group : set && group;
      return { set: roll.set, group: roll.group, matches };
    });
    return { counter: start + offset, cells };
  });
  const matching = columns.filter((column) => column.cells.some((cell) => cell.matches));
  return { filter, seed: position.seed, start, matchingCount: matching.length, columns: filter.filterMatches ? matching : columns };
}
