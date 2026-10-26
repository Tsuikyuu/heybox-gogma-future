import { z } from 'zod';
import { ALGORITHM, compile, compileRequirements, predict } from './engine';

export const uint = z.number().int().min(0).max(0xffffffff);
const weapon = z.number().int().min(0).max(13);
const attribute = z.number().int().min(0).max(9);
const roll = z.array(z.number().int()).length(5);
const position = z.object({ seed: uint, counter: uint, skill: uint.nullable() });
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
  calibrated: z.boolean(), aligned: z.boolean(), gate: z.boolean(),
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
  if (p.aligned && (!p.state || !p.gate)) ctx.addIssue({ code: 'custom', message: '执行位置或门控确认缺失' });
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
  if (!p.gate) throw new Error('请先确认本轮满足启用抽取位置的适用条件');
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
  if (!p.baseline || !p.gate) throw new Error('请先取得位置并确认适用条件');
  const state = { ...p.baseline, counter: uint.parse(p.baseline.counter + (sampled ? p.rolls.length : 0)) };
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
