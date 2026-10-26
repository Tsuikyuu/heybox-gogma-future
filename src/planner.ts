import { compileRequirements, predict } from './engine';
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
    edges.push(demands.flatMap((demand, index) => matches[index]!(rolls.get(`${demand.weapon}-${demand.attribute}`)![offset]!) ? [index] : []));
    attach(offset, new Set());
    if (assigned.some((value) => value < 0)) continue;
    const ordered = demands.map((demand, index) => ({ demand, counter: position.counter + assigned[index]!, roll: rolls.get(`${demand.weapon}-${demand.attribute}`)![assigned[index]!]! })).sort((a, b) => a.counter - b.counter);
    return { complete: true, searched: offset + 1, total: offset + 1, steps: ordered.map((step, index) => ({ ...step, padding: step.counter - (index ? ordered[index - 1]!.counter + 1 : position.counter) })) };
  }
  return { complete: false, searched: count, total: 0, steps: [], missing: demands.filter((_, index) => assigned[index] === -1) };
}
