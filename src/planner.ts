import { compileRequirements, predict, predictSkills } from './engine';
import type { Demand, Position } from './model';

// Every Reset consumes one shared counter. The first prefix with a full
// bipartite matching is therefore a minimum-total-reinforcement route.
export function shortestRoute(position: Position, demands: Demand[], limit = 10000) {
  const count = Math.min(limit, 0xffffffff - position.counter);
  const rolls = new Map<string, number[][]>();
  demands.forEach((demand) => {
    const key = `${demand.weapon}-${demand.attribute}`;
    if (!rolls.has(key)) rolls.set(key, predict(position.seed, demand.weapon, demand.attribute, position.counter, count));
  });
  const matches = demands.map((demand) => compileRequirements(demand.requirements));
  return matchRoute(position.counter, demands, count,
    (demand, offset) => rolls.get(`${demand.weapon}-${demand.attribute}`)![offset]!,
    (roll, index) => matches[index]!(roll), true);
}

export function shortestSkillRoute(position: Pick<Position, 'seed' | 'skill'>, demands: Demand[], limit = 10000) {
  if (position.skill === null) throw new Error('请先定位技能计数器');
  const count = Math.min(limit, 0xffffffff - position.skill);
  const rolls = new Map<string, ReturnType<typeof predictSkills>>();
  demands.forEach((demand) => {
    if (!demand.skills) throw new Error('技能路径需要技能组合需求');
    const key = `${demand.weapon}-${demand.attribute}`;
    if (!rolls.has(key)) rolls.set(key, predictSkills(position.seed, demand.weapon, demand.attribute, position.skill!, count));
  });
  return matchRoute(position.skill, demands, count,
    (demand, offset) => rolls.get(`${demand.weapon}-${demand.attribute}`)![offset]!,
    (roll, index) => (demands[index]!.skills!.set === null || roll.set === demands[index]!.skills!.set) && (demands[index]!.skills!.group === null || roll.group === demands[index]!.skills!.group));
}

function matchRoute<T>(start: number, demands: Demand[], count: number, rollAt: (demand: Demand, offset: number) => T, matches: (roll: T, index: number) => boolean, partial = false) {
  const edges: number[][] = [];
  const assigned = demands.map(() => -1);
  const attach = (offset: number, visited: Set<number>): boolean => edges[offset]!.some((index) => {
    if (visited.has(index)) return false;
    visited.add(index);
    if (assigned[index] !== -1 && !attach(assigned[index]!, visited)) return false;
    assigned[index] = offset;
    return true;
  });
  if (!demands.length) return { complete: true, searched: 0, total: 0, steps: [] };
  for (let offset = 0; offset < count; offset++) {
    edges.push(demands.flatMap((demand, index) => matches(rollAt(demand, offset), index) ? [index] : []));
    attach(offset, new Set());
    if (assigned.every((value) => value >= 0)) break;
  }
  const missing = demands.filter((_, index) => assigned[index] === -1);
  if (missing.length && !partial) return { complete: false, searched: count, total: 0, steps: [], missing };
  const ordered = demands.flatMap((demand, index) => assigned[index] === -1 ? [] : [{ demand, counter: start + assigned[index]!, roll: rollAt(demand, assigned[index]!) }]).sort((a, b) => a.counter - b.counter);
  const total = ordered.length ? ordered.at(-1)!.counter - start + 1 : 0;
  return { complete: !missing.length, searched: missing.length ? count : total, total, missing,
    steps: ordered.map((step, index) => ({ ...step, padding: step.counter - (index ? ordered[index - 1]!.counter + 1 : start) })) };
}
