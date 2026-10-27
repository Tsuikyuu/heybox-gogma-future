import { z } from 'zod';
import { artianPool, predictArtian } from './engine';
import type { Profile } from './model';

const counter = z.number().int().min(0).max(1000000);
export const artianParameters = z.object({ weapon: z.number().int().min(0).max(13), attribute: z.number().int().min(0).max(9) });
export const artianSchema = z.object({
  seed: z.number().int().min(0).max(0xffffffff),
  counters: z.record(z.string().regex(/^(?:[0-9]|1[0-3])$/), counter),
  session: artianParameters.extend({
    synced: z.boolean().default(false),
    rolls: z.array(z.array(z.number().int()).length(5)).max(100),
    search: z.object({ start: counter, end: counter, candidates: z.array(counter).max(10000) }).nullable(),
  }).nullable(),
}).superRefine((value, ctx) => {
  const s = value.session;
  if (!s) return;
  const pool = artianPool(s.weapon, s.attribute);
  if (s.rolls.some((roll) => roll.some((id) => !pool.some((b) => b.id === id)) || pool.some((b) => roll.filter((id) => id === b.id).length > b.cap))) ctx.addIssue({ code: 'custom', message: '普通机械武器样本不符合候选池或重复上限' });
  if (s.search && (s.search.end < s.search.start || s.search.end - s.search.start >= 10000 || s.search.end + s.rolls.length > 1000000 || s.rolls.length < 2 || s.search.candidates.some((c) => c < s.search!.start || c > s.search!.end || !predictArtian(value.seed, s.weapon, s.attribute, c, s.rolls.length).every((r, i) => r.every((id, slot) => id === s.rolls[i]![slot]))))) ctx.addIssue({ code: 'custom', message: '普通机械武器搜索结果无效' });
});

export function artianState(p: Profile) {
  const seed = p.state?.seed ?? p.seedHint;
  if (seed === null) throw new Error('请先确定共同种子');
  return p.artian?.seed === seed ? p.artian : { seed, counters: {}, session: null };
}

export function startArtianSampling(p: Profile, weapon: number, attribute: number): Profile {
  return { ...p, artian: { ...artianState(p), session: { ...artianParameters.parse({ weapon, attribute }), rolls: [], search: null, synced: false } } };
}

export function setArtianSampling(p: Profile, weapon: number, attribute: number): Profile {
  const state = artianState(p);
  const input = artianParameters.parse({ weapon, attribute });
  if (state.counters[input.weapon] !== undefined) throw new Error('该武器已保存制作位置，请选择未定位的武器');
  if (state.session?.weapon === input.weapon && state.session.attribute === input.attribute) return p;
  const rolls = state.session && state.counters[state.session.weapon] === undefined ? state.session.rolls : [];
  return { ...p, artian: artianSchema.parse({ ...state, session: { ...input, rolls, search: null } }) };
}

export function recordArtianSample(p: Profile, roll: number[] | null): Profile {
  const state = artianState(p);
  if (!state.session) throw new Error('请先设置采样武器');
  return { ...p, artian: artianSchema.parse({ ...state, session: { ...state.session, rolls: roll === null ? state.session.rolls.slice(0, -1) : [...state.session.rolls, roll], search: null, synced: false } }) };
}

export function editArtianSample(p: Profile, index: number, roll: number[]): Profile {
  const state = artianState(p);
  const s = state.session;
  if (!s || !Number.isInteger(index) || index < 0 || index >= s.rolls.length) throw new Error('制作样本不存在');
  return { ...p, artian: artianSchema.parse({ ...state,
    counters: Object.fromEntries(Object.entries(state.counters).filter(([weapon]) => Number(weapon) !== s.weapon)),
    session: { ...s, rolls: s.rolls.map((sample, i) => i === index ? roll : sample), search: null, synced: false },
  }) };
}

export function searchArtianCounter(p: Profile, start: number, end: number): Profile {
  const state = artianState(p);
  const s = state.session;
  if (!s || s.rolls.length < 2) throw new Error('请至少录入两把连续制作武器的完整五槽');
  counter.parse(start); counter.parse(end);
  if (end < start || end - start >= 10000 || end + s.rolls.length > 1000000) throw new Error('单次最多搜索 10,000 个位置，样本末尾须在 1,000,000 以内');
  const rolls = predictArtian(state.seed, s.weapon, s.attribute, start, end - start + s.rolls.length);
  const candidates = rolls.slice(0, end - start + 1).flatMap((_, i) => s.rolls.every((r, n) => r.every((id, slot) => id === rolls[i + n]![slot])) ? [start + i] : []);
  return { ...p, artian: { ...state, session: { ...s, search: { start, end, candidates }, synced: false } } };
}

export function setArtianCounter(p: Profile, weapon: number, value: number): Profile {
  const state = artianState(p);
  artianParameters.shape.weapon.parse(weapon);
  return { ...p, artian: { ...state, counters: { ...state.counters, [weapon]: counter.parse(value) } } };
}

export function alignArtianCounter(p: Profile, candidate: number, sampled: boolean): Profile {
  const s = artianState(p).session;
  if (!s?.search?.candidates.includes(candidate)) throw new Error('请选择本次搜索中的候选');
  const next = setArtianCounter(p, s.weapon, candidate + (sampled ? s.rolls.length : 0));
  return { ...next, artian: { ...next.artian!, session: { ...s, synced: true } } };
}
