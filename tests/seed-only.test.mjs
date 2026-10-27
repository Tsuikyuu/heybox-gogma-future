import { test } from 'bun:test';
import strict from 'node:assert/strict';
import { alignSkillCounter, newProfile, profileSchema, recordSkillSample, searchSkillCounter, selectSkillCandidate, setSkillCounter, skillPosition, startSkillSampling, verifySkillSample } from '../src/model.ts';
import { predictSkills } from '../src/engine.ts';
import { skillTableForecast } from '../src/forecast.ts';

test('seed-only import locates skills without a reinforcement counter, including persistence', () => {
  let profile = { ...newProfile('种子导入'), seedHint: 8524433 };
  profile = startSkillSampling(profile, { weapon: 10, attribute: 4 });
  const rolls = predictSkills(8524433, 10, 4, 186, 5);
  rolls.slice(0, 4).forEach((roll) => { profile = recordSkillSample(profile, roll.tableIndex); });
  profile = searchSkillCounter(profile, 0, 300);
  strict.ok(profile.skillSession.search.candidates.includes(186));
  profile = selectSkillCandidate(profile, 186);
  profile = verifySkillSample(profile, rolls[4].tableIndex);
  profile = alignSkillCounter(profile, true);
  profile = profileSchema.parse(JSON.parse(JSON.stringify(profile)));
  strict.equal(profile.state, null);
  strict.deepEqual(skillPosition(profile), { seed: 8524433, skill: 191 });
  const result = skillTableForecast(skillPosition(profile), { weapons: [{ weapon: 10, attribute: 4 }], count: 40, set: 0, group: 0 });
  strict.equal(result.columns.length, 40);
  strict.equal(result.columns[0].counter, 191);
});

test('known seed permits manual skill position, including zero, without inventing reinforcement position', () => {
  const profile = profileSchema.parse(setSkillCounter({ ...newProfile('种子零'), seedHint: 0 }, 0));
  strict.equal(profile.state, null);
  strict.deepEqual(skillPosition(profile), { seed: 0, skill: 0 });
  strict.throws(() => startSkillSampling(newProfile('未知'), { weapon: 0, attribute: 0 }));
});
