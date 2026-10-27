import { z } from 'zod';
import { artianSchema } from './artian';
import { ALGORITHM, compile, compileRequirements, predict, predictSkills } from './engine';

export const uint = z.number().int().min(0).max(0xffffffff);
const weapon = z.number().int().min(0).max(13);
const attribute = z.number().int().min(0).max(9);
const roll = z.array(z.number().int()).length(5);
const position = z.object({ seed: uint, counter: uint, skill: uint.nullable() });
const skillSession = z.object({
  seed: uint, weapon, attribute, rolls: z.array(uint.max(293)).max(100),
  search: z.object({ start: uint, end: uint, candidates: z.array(uint).max(10000) }).nullable(),
  candidate: uint.nullable(), verified: z.boolean(), synced: z.boolean(),
}).superRefine((s, ctx) => {
  if (s.search && (s.search.end < s.search.start || s.search.end - s.search.start >= 10000 ||
    s.search.candidates.some((c) => c < s.search!.start || c > s.search!.end))) ctx.addIssue({ code: 'custom', message: '技能搜索范围无效' });
  if (((s.verified || s.synced) && s.candidate === null) || (s.verified && s.rolls.length < 3)) ctx.addIssue({ code: 'custom', message: '技能校准状态无效' });
  if (s.candidate !== null && (!s.search?.candidates.includes(s.candidate) || s.rolls.length < 2 || s.candidate + s.rolls.length > 0xffffffff ||
    !predictSkills(s.seed, s.weapon, s.attribute, s.candidate, s.rolls.length).every((r, i) => r.tableIndex === s.rolls[i]))) ctx.addIssue({ code: 'custom', message: '技能候选与样本不符' });
});
const target = z.object({ id: z.string(), name: z.string().min(1).max(80), weapon, attribute, counter: uint, roll, demandId: z.string().optional() });
const demand = z.object({ id: z.string(), name: z.string().min(1).max(80), weapon, attribute, requirements: z.array(uint).length(5), achieved: z.boolean().default(false) });
const task = z.object({
  algorithm: z.literal(ALGORITHM), weapon, attribute,
  rolls: z.array(roll).min(1).max(100),
  seedStart: uint, seedEnd: uint, counterStart: uint, counterEnd: uint,
  nextSeed: z.number().int().min(0).max(0x100000000),
  nextCounter: z.number().int().min(0).max(0x100000000),
  candidates: z.array(position.omit({ skill: true })).max(2000),
  status: z.enum(['paused', 'complete', 'cancelled', 'overflow']),
}).superRefine((t, ctx) => {
  if (t.seedEnd < t.seedStart || t.counterEnd < t.counterStart || t.counterEnd - t.counterStart >= 10000 ||
    t.nextSeed < t.seedStart || t.nextSeed > t.seedEnd + 1 || t.nextCounter < t.counterStart || t.nextCounter > t.counterEnd + 1 ||
    (t.status === 'complete' && t.nextCounter !== t.counterEnd + 1) ||
    t.counterEnd + t.rolls.length > 0xffffffff ||
    t.candidates.some((c) => c.seed < t.seedStart || c.seed > t.seedEnd || c.counter < t.counterStart || c.counter > t.counterEnd)) {
    ctx.addIssue({ code: 'custom', message: '搜索区间或恢复游标无效（单任务最多 10,000 个位置）' });
  }
});

export const profileSchema = z.object({
  id: z.string(), name: z.string().min(1).max(80), platform: z.string().max(40), gameVersion: z.string().max(40),
  algorithm: z.literal(ALGORITHM),
  sampling: z.object({ weapon, attribute }).optional(),
  weapon: weapon.optional(), attribute: attribute.optional(),
  rolls: z.array(roll).max(100),
  state: position.nullable(), seedHint: uint.nullable(), skillHint: uint.nullable().default(null),
  // Legacy flags retained for archive compatibility; no longer user prerequisites.
  calibrated: z.boolean(), aligned: z.boolean(), gate: z.boolean().default(false),
  skillGate: z.boolean().default(false),
  skillSession: skillSession.nullable().default(null),
  artian: artianSchema.nullable().default(null),
  baseline: position.nullable(),
  checkpoint: z.object({ position, at: z.string(), achieved: z.array(z.string()).default([]) }).nullable(),
  targets: z.array(target).max(200),
  demands: z.array(demand).max(20).default([]),
  logs: z.array(z.object({ at: z.string(), text: z.string(), before: uint, after: uint, demandId: z.string().optional(), kind: z.enum(['padding', 'accepted', 'rejected', 'mismatch']).optional() })).max(2000),
  tasks: z.array(task).max(20),
}).transform(({ weapon, attribute, ...profile }) => ({
  ...profile,
  // Migrate legacy archive-level parameters into sampling metadata.
  sampling: profile.sampling ?? { weapon: weapon ?? 0, attribute: attribute ?? 0 },
})).superRefine((p, ctx) => {
  try {
    compile(p.sampling.weapon, p.sampling.attribute, p.rolls);
    p.tasks.forEach((t) => compile(t.weapon, t.attribute, t.rolls));
    p.targets.forEach((t) => compile(t.weapon, t.attribute, [t.roll]));
    p.demands.forEach((d) => compileRequirements(d.requirements));
  } catch (error) {
    ctx.addIssue({ code: 'custom', message: error instanceof Error ? error.message : '五槽数据无效' });
  }
  if (p.aligned && !p.state) ctx.addIssue({ code: 'custom', message: '执行位置缺失' });
  if (new Set(p.demands.map((d) => d.id)).size !== p.demands.length) ctx.addIssue({ code: 'custom', message: '需求标识重复' });
  if (p.targets.some((t) => !p.state || t.counter < 0 || !predict(p.state.seed, t.weapon, t.attribute, t.counter, 1)[0]!.every((id, i) => id === t.roll[i]))) {
    ctx.addIssue({ code: 'custom', message: '目标与种子预测不符' });
  }
});
export const archiveSchema = z.object({ version: z.literal(1), profiles: z.array(profileSchema).max(30), active: z.string().nullable() }).superRefine((data, ctx) => {
  if (new Set(data.profiles.map((p) => p.id)).size !== data.profiles.length || (data.active !== null && !data.profiles.some((p) => p.id === data.active))) {
    ctx.addIssue({ code: 'custom', message: '档案标识重复或当前档案不存在' });
  }
});
export type Profile = z.infer<typeof profileSchema>;
export type Task = z.infer<typeof task>;
export type Archive = z.infer<typeof archiveSchema>;
export type Position = z.infer<typeof position>;
export type Demand = z.infer<typeof demand>;
export const emptyArchive = (): Archive => ({ version: 1, profiles: [], active: null });

export function deleteProfile(archive: Archive, id: string): Archive {
  const profiles = archive.profiles.filter((p) => p.id !== id);
  return { ...archive, profiles, active: archive.active === id ? profiles[0]?.id ?? null : archive.active };
}

export function setCounter(p: Profile, counter: number): Profile {
  if (!p.state) throw new Error('请先确定种子与当前位置');
  const next = uint.parse(counter);
  if (next === p.state.counter) return p;
  return { ...p, state: { ...p.state, counter: next },
    logs: [...p.logs.slice(-1999), { at: new Date().toISOString(), before: p.state.counter, after: next, text: '手动修改当前计数' }],
  };
}

export function setSamplingWeapon(p: Profile, input: { weapon: number; attribute: number }): Profile {
  const sampling = z.object({ weapon, attribute }).parse(input);
  if (sampling.weapon === p.sampling.weapon && sampling.attribute === p.sampling.attribute) return p;
  return profileSchema.parse({ ...p, sampling, state: null, baseline: null, calibrated: false, aligned: false, targets: [], checkpoint: null });
}

export function skillPosition(p: Profile) {
  const seed = p.state?.seed ?? p.seedHint;
  return seed === null ? null : { seed, skill: p.state ? p.state.skill : p.skillHint };
}

export function setSkillCounter(p: Profile, counter: number): Profile {
  if (!skillPosition(p)) throw new Error('请先确定共同种子');
  const skill = uint.parse(counter);
  return { ...p, state: p.state ? { ...p.state, skill } : null, skillHint: skill, skillSession: null };
}

export function startSkillSampling(p: Profile, input: { weapon: number; attribute: number }): Profile {
  const position = skillPosition(p);
  if (!position) throw new Error('请先确定共同种子');
  if (position.skill !== null || p.skillSession?.synced) throw new Error('技能位置已确认，新一轮采样请建立新档案');
  const existing = p.skillSession?.seed === position.seed ? p.skillSession : null;
  if (existing?.weapon === input.weapon && existing.attribute === input.attribute) return p;
  return { ...p, skillHint: null,
    skillSession: skillSession.parse({ ...input, seed: position.seed, rolls: existing?.rolls ?? [], search: null, candidate: null, verified: false, synced: false }) };
}

export function recordSkillSample(p: Profile, sample: number | null): Profile {
  const session = requireSkillSession(p);
  if (session.synced) throw new Error('本轮位置已同步，请建立新一轮采样');
  const rolls = sample === null ? session.rolls.slice(0, -1) : [...session.rolls, uint.max(293).parse(sample)];
  if (rolls.length > 99) throw new Error('最多录入 99 抽，请预留一抽用于额外核对');
  return { ...p, skillSession: { ...session, rolls, search: null, candidate: null, verified: false } };
}

export function editSkillObservation(p: Profile, index: number, sample: number): Profile {
  const session = requireSkillSession(p);
  if (session.synced) throw new Error('本轮位置已同步，请建立新一轮采样');
  if (!Number.isInteger(index) || index < 0 || index >= session.rolls.length) throw new Error('技能样本不存在');
  const id = uint.max(293).parse(sample);
  return { ...p, skillSession: { ...session, rolls: session.rolls.map((roll, i) => i === index ? id : roll), search: null, candidate: null, verified: false } };
}

export function searchSkillCounter(p: Profile, start: number, end: number): Profile {
  const session = requireSkillSession(p);
  if (session.synced) throw new Error('请建立新一轮技能采样');
  if (session.rolls.length < 2) throw new Error('至少录入两抽连续完整技能对，建议四抽以上');
  uint.parse(start); uint.parse(end);
  if (end < start || end - start >= 10000 || end + session.rolls.length > 0xffffffff) throw new Error('单次搜索最多 10,000 个技能位置，且不可超出位置上限');
  const rolls = predictSkills(session.seed, session.weapon, session.attribute, start, end - start + session.rolls.length);
  const candidates = rolls.slice(0, end - start + 1).flatMap((_, i) => session.rolls.every((id, n) => rolls[i + n]!.tableIndex === id) ? [start + i] : []);
  return { ...p, skillSession: { ...session, search: { start, end, candidates }, candidate: null, verified: false } };
}

export function selectSkillCandidate(p: Profile, counter: number): Profile {
  const session = requireSkillSession(p);
  if (session.synced || !session.search?.candidates.includes(counter)) throw new Error('请选择当前搜索中的技能候选');
  return { ...p, skillSession: { ...session, candidate: counter, verified: false } };
}

export function verifySkillSample(p: Profile, sample: number): Profile {
  const session = requireSkillSession(p);
  if (session.candidate === null || session.verified || session.synced) throw new Error('请先选择待核对的技能候选');
  if (session.rolls.length >= 100) throw new Error('本轮样本已满，请重新采样');
  const counter = uint.parse(session.candidate + session.rolls.length);
  uint.parse(counter + 1);
  if (predictSkills(session.seed, session.weapon, session.attribute, counter, 1)[0]!.tableIndex !== uint.max(293).parse(sample)) throw new Error('额外技能对与预测不一致，请检查样本、武器属性及是否漏抽');
  return { ...p, skillSession: { ...session, rolls: [...session.rolls, sample], verified: true } };
}

export function alignSkillCounter(p: Profile, sampled: boolean): Profile {
  const session = requireSkillSession(p);
  if (session.candidate === null || session.synced) throw new Error('请先选择技能候选');
  const skill = uint.parse(session.candidate + (sampled ? session.rolls.length : 0));
  return { ...p, state: p.state ? { ...p.state, skill } : null, skillHint: skill, skillSession: { ...session, synced: true } };
}

function requireSkillSession(p: Profile) {
  if (!p.skillSession || p.skillSession.seed !== skillPosition(p)?.seed) throw new Error('请为当前种子建立技能采样');
  return p.skillSession;
}

export function newProfile(name: string, weapon = 0, attribute = 0): Profile {
  return profileSchema.parse({
    id: crypto.randomUUID(), name, sampling: { weapon, attribute }, platform: '未填写', gameVersion: '未知', algorithm: ALGORITHM,
    rolls: [], state: null, seedHint: null, calibrated: false, aligned: false, gate: false,
    baseline: null, checkpoint: null, targets: [], logs: [], tasks: [],
  });
}

export function parseCode(text: string): Position {
  const input = text.trim();
  const one = /^GSF1-(\d+)-(\d+)$/.exec(input);
  const two = /^GSF2-B(\d+)-G(\d+)-S(\d+)$/.exec(input);
  if (one) return position.parse({ seed: Number(one[1]), counter: Number(one[2]), skill: null });
  if (two) return position.parse({ seed: Number(two[1]), counter: Number(two[2]), skill: Number(two[3]) });
  throw new Error('请输入 GSF1-种子-复原位置 或 GSF2-B种子-G复原位置-S技能位置');
}

export function encodeCode(p: Position) {
  return p.skill === null ? `GSF1-${p.seed}-${p.counter}` : `GSF2-B${p.seed}-G${p.counter}-S${p.skill}`;
}

export function makeTask(p: Profile, input: { seedStart: number; seedEnd: number; counterStart: number; counterEnd: number }): Task {
  if (p.rolls.length < 2) throw new Error('至少录入两抽完整连续样本，建议六抽');
  compile(p.sampling.weapon, p.sampling.attribute, p.rolls);
  return task.parse({ ...input, algorithm: ALGORITHM, weapon: p.sampling.weapon, attribute: p.sampling.attribute,
    rolls: p.rolls.map((r) => [...r]), nextSeed: input.seedStart, nextCounter: input.counterStart, candidates: [], status: 'paused' });
}

export function useCandidate(p: Profile, t: Task, index: number): Profile {
  if (t.status !== 'complete') throw new Error('请先完成本次搜索范围');
  const candidate = t.candidates[index];
  if (!candidate) throw new Error('候选不存在');
  const predicted = predict(candidate.seed, t.weapon, t.attribute, candidate.counter, t.rolls.length);
  if (!predicted.every((r, n) => r.every((id, i) => id === t.rolls[n]![i]))) throw new Error('候选无法重现全部样本');
  const state = { ...candidate, skill: p.state?.seed === candidate.seed ? p.state.skill : p.seedHint === candidate.seed ? p.skillHint : null };
  return { ...p, state, baseline: state, seedHint: state.seed, aligned: false, calibrated: false, targets: [], checkpoint: null, demands: p.demands.map((d) => ({ ...d, achieved: false })) };
}

export function verifySample(p: Profile, sample: number[]): Profile {
  if (!p.baseline) throw new Error('请先选择候选');
  compile(p.sampling.weapon, p.sampling.attribute, [sample]);
  const expected = predict(p.baseline.seed, p.sampling.weapon, p.sampling.attribute, p.baseline.counter + p.rolls.length, 1)[0]!;
  if (!expected.every((id, i) => sample[i] === id)) throw new Error('额外一抽与预测不一致：请检查录入、武器参数及是否漏抽');
  return { ...p, rolls: [...p.rolls, sample], calibrated: true, aligned: false };
}

export function align(p: Profile, sampled: boolean): Profile {
  if (!p.baseline) throw new Error('请先取得位置');
  const state = { ...p.baseline, skill: p.state?.skill ?? null, counter: uint.parse(p.baseline.counter + (sampled ? p.rolls.length : 0)) };
  return { ...p, state, aligned: true };
}

export function advance(p: Profile, count: number, result: 'padding' | 'accepted' | 'rejected' | 'mismatch'): Profile {
  if (!p.state || !p.aligned) throw new Error('请先确认游戏与工具位置一致');
  if (!Number.isInteger(count) || count < 1) throw new Error('请输入已实际完成的正整数次数');
  const end = uint.parse(p.state.counter + count);
  const upcoming = p.targets.filter((t) => t.counter >= p.state!.counter).sort((a, b) => a.counter - b.counter);
  if (result === 'padding' && upcoming.some((t) => t.counter < end)) throw new Error('垫刀次数会越过目标，请先处理目标');
  const current = upcoming.filter((t) => t.counter === p.state!.counter);
  if (result !== 'padding' && (count !== 1 || current.length !== 1)) throw new Error('请解决同格冲突，并在目标位置确认结果');
  const demandId = result === 'accepted' ? current[0]?.demandId : undefined;
  return { ...p, state: { ...p.state, counter: end }, aligned: result !== 'mismatch',
    demands: p.demands.map((d) => d.id === demandId ? { ...d, achieved: true } : d),
    logs: [...p.logs.slice(-1999), { at: new Date().toISOString(), before: p.state.counter, after: end,
       kind: result, ...(demandId ? { demandId } : {}),
       text: result === 'padding' ? `已完成 ${count} 次垫刀` : `${current[0]!.name}：${{ accepted: '已核对并采用', rejected: '已抽取但未采用', mismatch: '结果不符，暂停核对' }[result]}` }],
  };
}

export function saveCheckpoint(p: Profile): Profile {
  if (!p.state || !p.aligned) throw new Error('先核对当前位置，再确认游戏保存');
  return { ...p, checkpoint: { position: { ...p.state }, at: new Date().toISOString(), achieved: p.demands.filter((d) => d.achieved).map((d) => d.id) } };
}

export function canUndoCount(p: Profile) {
  const last = p.logs.at(-1);
  return !!(p.aligned && p.state && last?.kind === 'padding' && last.after === last.before + 1 && last.after === p.state.counter && (!p.checkpoint || p.checkpoint.position.counter <= last.before));
}

export function undoCount(p: Profile): Profile {
  if (!canUndoCount(p)) throw new Error('没有可撤回的单次计数');
  const last = p.logs.at(-1)!;
  return { ...p, state: { ...p.state!, counter: last.before },
    logs: [...p.logs.slice(-1999), { at: new Date().toISOString(), before: last.after, after: last.before, text: '撤回一次垫刀计数' }],
  };
}

export function restoreCheckpoint(p: Profile): Profile {
  if (!p.checkpoint) throw new Error('暂无已确认的游戏保存点');
  return { ...p, state: { ...p.checkpoint.position }, aligned: true,
    demands: p.demands.map((d) => ({ ...d, achieved: p.checkpoint!.achieved.includes(d.id) })),
    logs: [...p.logs.slice(-1999), { at: new Date().toISOString(), before: p.state?.counter ?? p.checkpoint.position.counter,
      after: p.checkpoint.position.counter, text: '已在游戏回档到保存点' }] };
}

export function correctLastRecord(p: Profile): Profile {
  const last = p.logs.at(-1);
  if (!p.state || !last || last.after <= last.before || last.after !== p.state.counter) throw new Error('没有可修正的末次抽取记录');
  if (p.checkpoint && p.checkpoint.position.counter > last.before) throw new Error('这次操作已计入游戏保存点，请先核对保存点，不能直接撤销计数');
  return { ...p, state: { ...p.state, counter: last.before }, aligned: false,
    demands: p.demands.map((d) => d.id === last.demandId ? { ...d, achieved: false } : d),
    logs: [...p.logs.slice(-1999), { at: new Date().toISOString(), before: last.after, after: last.before, text: `修正工具误记：${last.text}；待核对游戏位置` }] };
}
