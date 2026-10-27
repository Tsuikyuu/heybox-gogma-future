import { test } from 'bun:test';
import strict from 'node:assert/strict';
import { newProfile, profileSchema, skillPosition } from '../src/model.ts';
import { predictSkills } from '../src/engine.ts';
import { shortestRoute, shortestSkillRoute } from '../src/planner.ts';

test('bonus route retains maximum partial matches and calculates padding from found demands', () => {
  const demands = profileSchema.parse({ ...newProfile('部分路径'), demands: Array.from({ length: 3 }, (_, i) => ({ id: String(i), name: `武器${i}`, weapon: 0, attribute: 0, requirements: [0, 0, 0, 0, 0] })) }).demands;
  const position = { seed: 8524433, counter: 480, skill: null };
  const route = shortestRoute(position, demands, 2);
  strict.equal(route.complete, false);
  strict.equal(route.steps.length, 2);
  strict.equal(route.missing.length, 1);
  strict.equal(route.searched, 2);
  strict.equal(route.total, 2);
  strict.deepEqual(route.steps.map((s) => s.counter), [480, 481]);
  strict.equal(route.steps.reduce((n, s) => n + s.padding + 1, 0), route.total);
  strict.equal(new Set([...route.steps.map((s) => s.demand.id), ...route.missing.map((d) => d.id)]).size, 3);
  const empty = shortestRoute({ ...position, counter: 0xffffffff }, demands);
  strict.equal(empty.steps.length, 0);
  strict.equal(empty.total, 0);
  strict.equal(empty.missing.length, 3);
});

test('skill requirements support either or both wildcard selectors without treating skill zero as a wildcard', () => {
  const position = { seed: 8524433, skill: 186 };
  const rolls = predictSkills(position.seed, 10, 4, position.skill, 100);
  [{ set: null, group: null }, { set: 0, group: null }, { set: null, group: 9 }, { set: 19, group: 9 }].forEach((skills) => {
    const profile = profileSchema.parse({ ...newProfile('任意技能'), demands: [{ id: 'a', name: '武器', weapon: 10, attribute: 4, bonusEnabled: false, requirements: [0, 0, 0, 0, 0], skills }] });
    const restored = profileSchema.parse(JSON.parse(JSON.stringify(profile)));
    strict.deepEqual(restored.demands[0].skills, skills);
    const offset = rolls.findIndex((r) => (skills.set === null || r.set === skills.set) && (skills.group === null || r.group === skills.group));
    const route = shortestSkillRoute(position, restored.demands, 100);
    strict.equal(route.complete, offset !== -1);
    strict.equal(route.total, offset + 1);
    strict.equal(route.steps[0].counter, position.skill + offset);
  });
});

test('skill route matches exhaustive assignments for multiple weapons and duplicate demands', () => {
  [0, 1, 8524433, 0xffffffff].flatMap((seed) => [false, true].map((duplicate) => ({ seed, duplicate }))).forEach(({ seed, duplicate }) => {
    const position = { seed, skill: 186 };
    const weapons = [{ weapon: 10, attribute: 4 }, { weapon: 3, attribute: 1 }, { weapon: 10, attribute: 4 }];
    const streams = weapons.map((w) => predictSkills(seed, w.weapon, w.attribute, 186, 8));
    const demands = weapons.map((w, i) => ({ ...w, id: String(i), name: String(i), bonusEnabled: false, requirements: [0, 0, 0, 0, 0], skills: { set: streams[i][duplicate && i === 2 ? 0 : i].set, group: streams[i][duplicate && i === 2 ? 0 : i].group }, achieved: false }));
    const candidates = demands.map((d, i) => streams[i].flatMap((roll, offset) => roll.set === d.skills.set && roll.group === d.skills.group ? [offset] : []));
    const totals = candidates[0].flatMap((a) => candidates[1].flatMap((b) => candidates[2].flatMap((c) => new Set([a, b, c]).size === 3 ? [Math.max(a, b, c) + 1] : [])));
    const route = shortestSkillRoute(position, demands, 8);
    strict.equal(route.complete, totals.length > 0);
    if (!route.complete) return;
    strict.equal(route.total, Math.min(...totals));
    strict.equal(new Set(route.steps.map((s) => s.counter)).size, 3);
    strict.equal(route.steps.reduce((n, s) => n + s.padding + 1, 0), route.total);
    route.steps.forEach((step) => {
      strict.equal(step.roll.set, step.demand.skills.set);
      strict.equal(step.roll.group, step.demand.skills.group);
    });
  });
});

test('combined demands persist, old bonus demands migrate, and skill-only plans need no bonus position', () => {
  const base = { id: 'one', name: '武器', weapon: 10, attribute: 4, requirements: [0, 0, 0, 0, 0] };
  const legacy = profileSchema.parse({ ...newProfile('旧档案'), demands: [base] });
  strict.equal(legacy.demands[0].bonusEnabled, true);
  strict.equal(legacy.demands[0].skills, null);
  const roll = predictSkills(8524433, 10, 4, 186, 1)[0];
  const profile = profileSchema.parse({ ...legacy, seedHint: 8524433, skillHint: 186, demands: [{ ...base, bonusEnabled: false, skills: { set: roll.set, group: roll.group } }] });
  const restored = profileSchema.parse(JSON.parse(JSON.stringify(profile)));
  strict.equal(restored.state, null);
  strict.equal(shortestSkillRoute(skillPosition(restored), restored.demands).total, 1);
  const combined = profileSchema.parse({ ...restored, state: { seed: 8524433, counter: 480, skill: 186 }, demands: [{ ...restored.demands[0], bonusEnabled: true }] });
  strict.equal(shortestRoute(combined.state, combined.demands).steps[0].counter, 480);
  strict.equal(shortestSkillRoute(skillPosition(combined), combined.demands).steps[0].counter, 186);
  strict.throws(() => profileSchema.parse({ ...legacy, demands: [{ ...base, bonusEnabled: false }] }));
  strict.throws(() => profileSchema.parse({ ...legacy, demands: [{ ...base, skills: { set: 21, group: 0 } }] }));
  strict.throws(() => shortestSkillRoute({ seed: 1, skill: null }, restored.demands));
  strict.equal(shortestSkillRoute({ seed: 1, skill: 0xffffffff }, restored.demands).complete, false);
  strict.equal(shortestSkillRoute({ seed: 1, skill: 0 }, []).total, 0);
});
