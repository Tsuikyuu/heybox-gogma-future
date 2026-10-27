import './styles.css';
import { z } from 'zod';
import { setSamplingWeapon } from './model';
import { artianBonuses, artianPool, predictArtian } from './engine';
import { alignArtianCounter, artianParameters, artianState, editArtianSample, recordArtianSample, searchArtianCounter, setArtianSampling } from './artian';
import { ALGORITHM, attributes, bonuses, compile, compileRequirements, pool, predict, predictKeep, predictSkills, weapons } from './engine';
import { advance, align, archiveSchema, deleteProfile, emptyArchive, makeTask, newProfile, parseCode, profileSchema, restoreCheckpoint, saveCheckpoint, setCounter, uint, undoCount, useCandidate, verifySample } from './model';
import type { Archive, Position, Profile, Task } from './model';
import { runSearch, searchProgress } from './search';
import { openStorage, standalone } from './storage';
import { mountSelectors } from './selector';
import { shortestRoute, shortestSkillRoute } from './planner';
import { skillTableForecast } from './forecast';
import { skillCsv } from './csv';
import { skillGroups, skillSets } from './skills';
import { alignSkillCounter, editSkillObservation, recordSkillSample, searchSkillCounter, selectSkillCandidate, setSkillCounter, skillPosition, startSkillSampling, verifySkillSample } from './model';

const app = document.querySelector<HTMLDivElement>('#app')!;
let archive = emptyArchive();
let storage: Awaited<ReturnType<typeof openStorage>>;
let tab = 'observe';
let entry = '';
let aboutReturn = '';
let deletingProfile = '';
let busy = false;
let searching = false;
let stop = false;
let editSample: number | null = null;
let editSkillSample: number | null = null;
let artianEdit: { profile: string; index: number } | null = null;
let preview: Position | null = null;
let renderedView = '';
let messageTimer: ReturnType<typeof setTimeout> | undefined;
const predictionDrafts = new Map<string, { weapon: number; attribute: number }>();
const logPages = new Map<string, number>();
let prediction: { weapon: number; attribute: number; name: string; rows: { counter: number; roll: number[] }[]; limit: number; page: number; requirements: number[] } | null = null;
let predictionTrack = 'bonus';
let bonusOperation: 'reset' | 'keep' = 'reset';
let keepPrediction: { profile: string; seed: number; start: number; weapon: number; attribute: number; layout: number[]; requirements: number[]; count: number; page: number; rows: { counter: number; roll: number[] }[] } | null = null;
let observeTrack = 'bonus';
let artianPrediction: { profile: string; seed: number; start: number; weapon: number; attribute: number; count: number; requirements: number[]; page: number; rows: { counter: number; roll: number[] }[] } | null = null;
let planTrack: 'bonus' | 'skill' = 'bonus';
let skillTableVertical = false;
let skillTablePrediction: (ReturnType<typeof skillTableForecast> & { profile: string; page: number }) | null = null;
let skillPrediction: { profile: string; seed: number; start: number; weapon: number; attribute: number; set: number[]; group: number[]; count: number; page: number; rows: (ReturnType<typeof predictSkills>[number] & { counter: number })[] } | null = null;

const escape = (value: unknown) => String(value).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const button = (label: string, action: string, value = '', style = '') => `<button type="button" class="${style}${action === 'target' && label === '已加入' ? ' is-saved' : ''}" data-action="${action}" data-value="${escape(value)}"${action === 'tab' && value === tab ? ' aria-current="page"' : ''}>${label}</button>`;
const field = (label: string, name: string, value = '', type = 'text', extra = '') => `<label>${label}<input name="${name}" type="${type}" value="${escape(value)}" ${extra}></label>`;
const number = (label: string, name: string, value = '', max = 0xffffffff) => field(label, name, value, 'number', `min="0" max="${max}" step="1" required`);
const select = (label: string, name: string, list: string[], selected: number) => `<label>${label}<select name="${name}">${list.map((text, i) => `<option value="${i}" ${i === selected ? 'selected' : ''}>${text}</option>`).join('')}</select></label>`;
const multiSelect = (label: string, name: string, list: string[], selected: number[]) => `<label>${label}（多选）<select name="${name}" multiple><option value="" ${selected.length ? '' : 'selected'}>不限</option>${list.map((text, i) => `<option value="${i}" ${selected.includes(i) ? 'selected' : ''}>${text}</option>`).join('')}</select></label>`;
const check = (name: string, text: string) => `<label class="check"><input type="checkbox" name="${name}" required>${text}</label>`;
const submit = (text: string) => `<button class="primary" type="submit">${text}</button>`;
const predictionPager = (action: string, page: number, count: number) => `<div class="log-pagination" role="group" aria-label="预测结果分页"><button type="button" data-action="${action}" data-value="-1" ${page === 0 ? 'data-unavailable disabled' : ''}>上一页</button><span class="muted">${page + 1} / ${Math.max(1, Math.ceil(count / 30))}</span><button type="button" data-action="${action}" data-value="1" ${(page + 1) * 30 >= count ? 'data-unavailable disabled' : ''}>下一页</button></div>`;
const current = () => archive.profiles.find((p) => p.id === archive.active);
const chips = (roll: number[]) => `<div class="chips">${roll.map((id) => `<span class="bonus b${bonuses.find((b) => b.id === id)?.category}">${bonuses.find((b) => b.id === id)?.name}</span>`).join('')}</div>`;

function observationRecords(rows: string[], options: { solo?: boolean; editAction?: string; deleteAction?: string; deleteLabel?: string }) {
  if (!rows.length) return '';
  return `<section class="card records-card${options.solo ? ' solo' : ''}"><h3>观测记录 <span class="count">${rows.length}</span></h3><div class="records-list">${rows.map((content, i) => `<article class="sample"><b>${String(i + 1).padStart(2, '0')}</b>${content}${options.editAction ? button('修改', options.editAction, String(i), 'small') : ''}</article>`).join('')}</div>${options.deleteAction ? button(options.deleteLabel ?? '删除最后一抽', options.deleteAction, '', 'small text-button') : ''}</section>`;
}

function message(text: string, error = false) {
  clearTimeout(messageTimer);
  const node = document.querySelector<HTMLElement>('#message')!;
  node.textContent = text;
  node.className = error ? 'message error' : 'message';
  node.hidden = !text;
  if (text) {
    node.getAnimations().forEach((animation) => animation.cancel());
    if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches) node.animate([
      { opacity: 0, translate: '0 16px' },
      { opacity: 1, translate: '0 0' },
    ], { duration: 200, easing: 'ease-out' });
    messageTimer = setTimeout(() => { node.hidden = true; }, Math.max(error ? 6000 : 2200, Math.min(text.length * 100, 15000)));
  }
}

function fail(error: unknown) {
  const text = error instanceof z.ZodError ? error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('；') : error instanceof Error ? error.message : '操作失败，请重试';
  message(text, true);
}

async function commit(next: Archive) {
  await storage.write(next);
  archive = next;
}

async function update(p: Profile) {
  const changedLogs = archive.profiles.find((item) => item.id === p.id)?.logs !== p.logs;
  await commit({ ...archive, profiles: archive.profiles.map((item) => item.id === p.id ? p : item) });
  if (changedLogs) logPages.delete(p.id);
}

function slots(p: Profile, sample?: number[]) {
  return `<div class="slots">${Array.from({ length: 5 }, (_, i) => `<label><span class="slot-number" aria-hidden="true">0${i + 1}</span><select name="slot${i}" aria-label="槽位 ${i + 1}" required><option value="">选择加成</option>${pool(p.sampling.weapon, p.sampling.attribute).map((b) => `<option value="${b.id}" ${sample?.[i] === b.id ? 'selected' : ''}>${b.name}</option>`).join('')}</select></label>`).join('')}</div>`;
}

function entryView() {
  if (entry === 'manage') return archiveManager();
  if (entry === 'about') return `<section class="card"><div class="section-heading"><h2>关于</h2>${button('返回', 'about-back', '', 'small')}</div>${standalone ? '<p class="preview-label"><i aria-hidden="true"></i>开发预览</p>' : ''}<p>怪物猎人：荒野 · 巨戟武器完全重抽辅助</p><p>算法参考 GogmaSeedFinder / WiseHorror GARP<br>${ALGORITHM}</p><p>本版尚待小黑盒真机验收。技能预测已对照上游公式向量，尚未独立实机验证；Keep 预测后续提供。</p></section>`;
  if (entry === 'import') return `<section class="card"><div class="section-heading"><h2>导入档案</h2>${button('返回', 'home', '', 'small')}</div>
    <form data-form="preview"><label>续接码<textarea name="code" placeholder="GSF2-B…-G…-S…" required></textarea></label>${submit('解析并预览')}</form>
    ${preview ? `<div class="notice">种子 <b>${preview.seed}</b> · 下一次复原位置 <b>${preview.counter}</b> · 技能位置 ${preview.skill ?? '未知'}</div>
    <form data-form="import">${field('档案名称', 'name', '我的观星档案', 'text', 'required maxlength="80"')}${submit('建立档案')}</form>` : ''}
    <details><summary>手动输入种子与位置</summary><form data-form="manual"><div class="grid">${number('种子', 'seed')}${field('下一次复原位置（不知道可留空）', 'counter', '', 'number', 'min="0" max="4294967295" step="1"')}${field('技能位置（可留空）', 'skill', '', 'number', 'min="0" max="4294967295" step="1"')}</div>${submit('建立待核对档案')}</form></details>
    <details><summary>恢复完整备份</summary><form data-form="backup"><label>JSON 备份<textarea name="json" required></textarea></label>${submit('导入为新档案')}</form></details></section>`;
  return `<section class="card"><div class="section-heading"><h2>新建档案</h2>${current() ? button('返回', 'home', '', 'small') : ''}</div><form data-form="new"><div class="grid">${field('档案名称', 'name', '我的第一次观星', 'text', 'required maxlength="80"')}${field('平台', 'platform', '', 'text', 'placeholder="例如 PC / PS5" maxlength="40"')}${field('游戏版本', 'gameVersion', '', 'text', 'placeholder="不知道可留空" maxlength="40"')}</div>${check('saved', '我已在采样前保存游戏，能够回到这个基线')}${submit('开始记录')}</form></section>`;
}

function observe(p: Profile) {
  const tracks = `<div class="actions prediction-tracks" role="group" aria-label="观星类型">${button('复原加成', 'observe-track', 'bonus', observeTrack === 'bonus' ? 'primary' : '')}${button('技能组合', 'observe-track', 'skill', observeTrack === 'skill' ? 'primary' : '')}${button('普通机械武器', 'observe-track', 'artian', observeTrack === 'artian' ? 'primary' : '')}</div>`;
  return tracks + observeStateCard(p) + (observeTrack === 'artian' ? artianObserveView(p) : observeTrack === 'skill' ? skillObserveView(p) : bonusObserveView(p));
}

function observeStateCard(p: Profile) {
  const position = skillPosition(p);
  if (!position) return `<section class="card empty"><h2>尚未确定共同种子</h2><p>请先导入种子，或通过巨戟复原加成观星识别种子。</p>${observeTrack !== 'bonus' ? button('前往复原观星', 'observe-track', 'bonus', 'primary') : ''}</section>`;
  const ready = !predictionGate(p, observeTrack);
  return `<section class="card state-card"><h3>种子 ${position.seed}</h3><p>下一次复原位置 <b>${p.state?.counter ?? '未知'}</b> · 技能位置 <b>${position.skill ?? '未知'}</b></p>${observeTrack === 'artian' ? `<p>普通机械武器已定位 <b>${Object.keys(artianState(p).counters).length} / ${weapons.length}</b></p>` : ''}${ready ? button('查看预测', 'observe-prediction', '', 'primary') : ''}</section>`;
}

function skillObserveView(p: Profile) {
  const position = skillPosition(p);
  if (!position) return '';
  const s = p.skillSession?.seed === position.seed ? p.skillSession : null;
  return `
    ${s && s.candidate !== null && !s.synced ? `<section class="card"><form data-form="skill-align"><label>现在的游戏位置<select name="mode"><option value="baseline">我已回到技能采样前基线</option><option value="sampled">我没有回档，仍在全部 ${s.rolls.length} 抽样本之后</option></select></label><p>回档后下一位置为 ${s.candidate}，未回档为 ${s.candidate + s.rolls.length}。若回档也改变了复原进度，请核对复原位置。</p>${check('aligned', '我已核对游戏实际位置；工具不会代我回档')}${submit('确认位置，进入执行准备')}</form></section>` : ''}
    ${skillSamplingView(p)}`;
}

function bonusObserveView(p: Profile) {
  const latest = p.tasks.at(-1);
  return `
    ${!p.aligned ? `<section class="card"><h3>采样武器</h3><form data-form="sampling-weapon"><div class="grid">${select('武器种类', 'weapon', weapons, p.sampling.weapon)}${select('属性 / 异常', 'attribute', attributes, p.sampling.attribute)}</div><p class="muted">选择后自动保存，录入与搜索使用当前武器和属性。</p></form></section>` : ''}
    ${p.state && !p.aligned ? `<section class="card"><form data-form="align"><label>现在的游戏位置<select name="mode"><option value="baseline">我已回到采样前基线 / 导入码对应的位置</option><option value="sampled">我没有回档，仍在全部已录样本之后</option><option value="current">已核对与当前工具位置 ${p.state.counter} 一致</option></select></label>${check('aligned', '我已核对游戏实际位置；工具不会代我回档')}${submit('确认位置，进入执行准备')}</form></section>` : ''}
    ${!p.aligned ? `<section class="card sample-card${p.rolls.length ? '' : ' solo'}"><h3>${editSample === null ? `录入第 ${p.rolls.length + 1} 抽` : `修改第 ${editSample + 1} 抽`}</h3><p>${weapons[p.sampling.weapon]} · ${attributes[p.sampling.attribute]} · 连续记录，至少两抽，建议六抽。</p><form data-form="sample">${slots(p, editSample === null ? undefined : p.rolls[editSample])}<div class="actions">${submit(editSample === null ? '保存这一抽' : '保存修改')}${editSample !== null ? button('取消修改', 'edit-cancel') : ''}</div></form>
      ${p.baseline && !p.calibrated ? `<details><summary>用新抽取的额外一抽验证候选</summary><p>以下一抽须紧接已录的 ${p.rolls.length} 抽之后，不能重复填写旧结果。验证成功会追加这条样本。</p><form data-form="verify">${slots(p)}${submit('核对额外一抽')}</form></details>` : ''}</section>` : '<p class="notice">已进入正式位置。新一轮采样请建立新档案，避免混入当前执行记录。</p>'}
    ${observationRecords(p.rolls.map(chips), { solo: p.aligned, editAction: p.aligned ? undefined : 'edit', deleteAction: p.aligned ? undefined : 'delete-sample' })}
    ${!p.aligned ? `<section class="card"><h3>搜索种子与位置</h3><form data-form="search"><div class="grid">${number('种子下界', 'seedStart', String(p.seedHint ?? 0))}${number('种子上界', 'seedEnd', String(p.seedHint ?? 99999999))}${number('起始位置下界', 'counterStart')}${number('起始位置上界', 'counterEnd')}</div>${submit('开始搜索')}</form></section>` : ''}
    ${latest ? searchView(latest, p) : ''}
    ${p.tasks.length > 1 ? `<details class="card search-history"><summary>历史搜索范围（${p.tasks.length - 1} 个）</summary>${p.tasks.slice(0, -1).map((t) => `<p>种子 ${t.seedStart}–${t.seedEnd} / 位置 ${t.counterStart}–${t.counterEnd}：${t.status === 'complete' ? '范围完成' : '未完成'}，${searchProgress(t).percent.toFixed(1)}%，${t.candidates.length} 个候选</p>`).join('')}</details>` : ''}`;
}

function searchView(t: Task, p: Profile) {
  const matching = t.weapon === p.sampling.weapon && t.attribute === p.sampling.attribute && JSON.stringify(t.rolls) === JSON.stringify(p.rolls);
  return `<section class="card" id="search-card"><h3>${searching ? '正在搜索 · 保持页面在前台' : '最近搜索任务'}</h3><p>${weapons[t.weapon]} · ${attributes[t.attribute]} · 种子 ${t.seedStart}–${t.seedEnd} · 位置 ${t.counterStart}–${t.counterEnd}</p><div id="search-progress"></div>
    <div class="actions">${searching ? button('暂停并保存进度', 'pause', '', 'primary') : t.status === 'paused' && matching ? button('继续搜索', 'resume', '', 'primary') : ''}${!searching && t.status === 'paused' ? button('取消此任务', 'cancel-search') : ''}</div>
    ${!matching ? '<p class="notice">观测已更新，此任务保留为历史结果。请用当前样本建立新搜索。</p>' : ''}
    ${t.status === 'overflow' ? '<p class="notice">候选过多，已停止。请补充连续样本或缩小范围后重新搜索。</p>' : ''}
    ${t.status === 'complete' && !t.candidates.length ? '<p class="notice">本范围内零候选。检查槽位、武器属性、连续性与范围，再修正或扩展。</p>' : ''}
    ${t.status === 'complete' && t.candidates.length > 1 ? '<p class="notice">有多个候选，建议追加连续样本，再以相同范围重新搜索。</p>' : ''}
    ${t.status === 'complete' && t.candidates.length === 1 ? '<p class="notice">本次范围内唯一，不代表所有范围内唯一。选用后请额外一抽核对。</p>' : ''}
    ${!searching ? t.candidates.slice(0, 30).map((c, i) => `<div class="candidate"><span>种子 <b>${c.seed}</b> / 起始位置 <b>${c.counter}</b></span>${t.status === 'complete' && matching && !p.aligned ? button('选用并校准', 'candidate', String(i), 'small') : '<span class="muted">待完成 / 历史候选</span>'}</div>`).join('') : ''}
    ${t.candidates.length > 30 ? '<p>仅展示前 30 个候选，请补充样本缩小范围。</p>' : ''}</section>`;
}

function progressView(t: Task, rate = 0) {
  const node = document.querySelector('#search-progress');
  if (!node) return;
  const progress = searchProgress(t);
  const seconds = rate ? (progress.total - progress.done) / rate : 0;
  node.innerHTML = `<progress aria-label="搜索进度" max="100" value="${progress.percent}"></progress><p><b>${progress.percent.toFixed(2)}%</b> · ${t.candidates.length} 个候选 · ${t.status === 'complete' ? '范围完成' : searching ? '搜索中' : '已停止'}${rate && searching ? `<br><span class="muted">剩余计算约 ${Math.ceil(seconds / 60)} 分钟</span>` : ''}</p>`;
}

function archiveManager() {
  return `<div class="section-heading"><h2>管理存档</h2>${button('返回', 'home', '', 'small')}</div>${archive.profiles.length ? archive.profiles.map((p) => {
    const position = skillPosition(p);
    return `<section class="card archive-card"><div class="section-heading"><h3>${escape(p.name)}</h3>${archive.active === p.id ? '<span class="badge">当前存档</span>' : ''}</div><p class="muted archive-code">GSF2-B${position?.seed ?? '?'}-G${p.state?.counter ?? '?'}-S${position?.skill ?? '?'}</p>
      <form data-form="profile-edit" data-profile="${escape(p.id)}">${field('档案名称', 'name', p.name, 'text', 'required maxlength="80"')}<div class="grid">${p.state ? number('当前复原计数（下一次复原位置）', 'counter', String(p.state.counter)) : '<p class="muted">尚未确定复原位置，暂不能修改复原计数。</p>'}${position ? field('当前技能计数（下一次技能位置）', 'skill', position.skill === null ? '' : String(position.skill), 'number', `min="0" max="4294967295" step="1" ${position.skill === null ? 'placeholder="未知，可手动填写"' : 'required'}`) : '<p class="muted">尚未确定种子，暂不能修改技能计数。</p>'}</div>${submit('保存修改')}</form><div class="actions archive-actions">${deletingProfile === p.id ? `<span>删除此存档？</span>${button('确认删除', 'delete-profile', p.id, 'small primary')}${button('取消', 'cancel-delete-profile', '', 'small')}` : button('删除存档', 'confirm-delete-profile', p.id, 'small')}</div></section>`;
  }).join('') : '<section class="card empty"><p>暂无存档</p></section>'}`;
}

function predictView(p: Profile) {
  const tracks = `<div class="actions prediction-tracks" role="group" aria-label="预测类型">${button('复原加成', 'prediction-track', 'bonus', predictionTrack === 'bonus' ? 'primary' : '')}${button('技能组合', 'prediction-track', 'skill', predictionTrack === 'skill' ? 'primary' : '')}${button('普通机械武器', 'prediction-track', 'artian', predictionTrack === 'artian' ? 'primary' : '')}</div>`;
  const gate = predictionGate(p, predictionTrack);
  if (gate) return tracks + gate;
  return tracks + (predictionTrack === 'artian' ? artianPredictView(p) : predictionTrack === 'skill' ? skillPredictView(p) : bonusPredictView(p));
}

function predictionGate(p: Profile, track: string) {
  const position = skillPosition(p);
  const label = track === 'skill' ? '技能' : '复原加成';
  const counter = track === 'skill' ? '技能' : track === 'artian' ? '普通机械武器制作' : '复原加成';
  const ready = position && (track === 'skill' ? position.skill !== null : track === 'artian' ? Object.keys(artianState(p).counters).length > 0 : p.state !== null && p.aligned);
  if (ready) return '';
  return `<section class="card empty"><h2>${position ? `尚未确认${label}位置` : '尚未确定共同种子'}</h2><p class="muted">请先导入种子或通过观星确定种子，再定位${counter}计数器。</p>${button('前往观星', !position ? 'bonus-observe' : track === 'skill' ? 'skill-observe' : track === 'artian' ? 'artian-observe' : 'bonus-observe', '', 'primary')}</section>`;
}

function artianChips(roll: number[]) {
  return `<div class="chips">${roll.map((id) => `<span class="bonus b${artianBonuses.find((b) => b.id === id)!.category}">${artianBonuses.find((b) => b.id === id)!.name}</span>`).join('')}</div>`;
}

function artianObserveView(p: Profile) {
  if (!skillPosition(p)) return '';
  const state = artianState(p);
  const s = state.session && state.counters[state.session.weapon] === undefined ? state.session : null;
  const available = weapons.flatMap((name, weapon) => state.counters[weapon] === undefined ? [{ name, weapon }] : []);
  const editing = artianEdit?.profile === p.id && s?.rolls[artianEdit.index] ? artianEdit.index : null;
  return `<section class="card"><h3>普通机械武器 · R8</h3><p>制作计数器按武器种类独立，属性间共用，与巨戟复原／技能计数器独立。</p><p>每制作一把对应种类的 R8 武器推进一次；复原强化同一把武器不会推进制作计数器。</p></section>
    <section class="artian-positions"><h3>武器定位列表 <span class="count">${Object.keys(state.counters).length} / ${weapons.length}</span></h3><div class="artian-position-grid" role="list" aria-label="普通机械武器定位状态">${weapons.map((weapon, i) => `<div class="artian-position-cell${state.counters[i] !== undefined ? ' is-located' : ''}" role="listitem"><b>${weapon}</b><span>${state.counters[i] !== undefined ? `位置 ${state.counters[i]}` : '未定位'}</span></div>`).join('')}<div class="artian-position-cell is-empty" aria-hidden="true"></div></div></section>
    ${available.length ? `<section class="card"><h3>采样武器</h3><p>先保存游戏，再连续制作相同种类、相同属性条件的 R8 武器，每把复原至五槽，按从上到下记录。至少两把，建议多录几把以缩小候选。</p><form data-form="artian-weapon"><div class="grid"><label>武器种类<select name="weapon">${available.map((item) => `<option value="${item.weapon}" ${item.weapon === (s?.weapon ?? available[0]!.weapon) ? 'selected' : ''}>${item.name}</option>`).join('')}</select></label>${select('属性 / 异常', 'attribute', ['无', '有'], s?.attribute ? 1 : 0)}</div><p class="muted">选择后自动保存，录入与搜索使用当前武器和属性。修改保留样本，需重新搜索。已定位武器不再列出。</p>${s ? '' : submit('开始采样')}</form></section>` : '<section class="card"><h3>全部武器已完成定位</h3></section>'}
    ${s ? `<section class="card sample-card${s.rolls.length ? '' : ' solo'}" id="artian-sample-card"><h3>${editing === null ? `录入第 ${s.rolls.length + 1} 把` : `修改第 ${editing + 1} 把`}</h3><p>${weapons[s.weapon]} · ${s.attribute ? '有属性/异常' : '无属性/异常'} · 连续制作，每把记录完整五槽。</p><form data-form="artian-sample"><div class="slots">${Array.from({ length: 5 }, (_, i) => `<label><span class="slot-number" aria-hidden="true">0${i + 1}</span><select name="slot${i}" aria-label="槽位 ${i + 1}" required><option value="">选择加成</option>${artianPool(s.weapon, s.attribute).map((b) => `<option value="${b.id}" ${editing !== null && s.rolls[editing]![i] === b.id ? 'selected' : ''}>${b.name}</option>`).join('')}</select></label>`).join('')}</div><div class="actions">${submit(editing === null ? '记录这一抽' : '保存修改')}${editing !== null ? button('取消修改', 'artian-edit-cancel') : ''}</div></form></section>
    ${observationRecords(s.rolls.map(artianChips), { editAction: 'artian-edit', deleteAction: 'artian-delete-sample', deleteLabel: '删除最后一把' })}
    <section class="card"><h3>定位制作计数器</h3><form data-form="artian-search"><div class="grid">${number('第一把制作位置下界', 'start', String(s.search?.start ?? 0), 1000000)}${number('第一把制作位置上界', 'end', String(s.search?.end ?? 9999), 1000000)}</div>${submit('搜索位置')}</form><p class="muted">每次最多搜索 10,000 个位置。多个候选时可追加连续样本后重搜。</p></section>
    ${s.search && !s.synced && state.counters[s.weapon] === undefined ? `<section class="card"><h3>${s.search.candidates.length} 个候选</h3>${!s.search.candidates.length ? '<p>本范围内没有匹配，请检查五槽顺序、武器、属性与搜索范围。</p>' : `<form data-form="artian-align"><label>第一把制作位置<select name="candidate">${s.search.candidates.map((c) => `<option value="${c}">${c}</option>`).join('')}</select></label><label>游戏当前进度<select name="mode"><option value="baseline">已回档至采样前</option><option value="sampled">未回档，仍在全部 ${s.rolls.length} 把样本之后</option></select></label><p class="muted">未回档时将加上样本把数。范围内唯一候选不代表全范围唯一，可追加新制作样本核对。</p>${submit('确认并保存制作位置')}</form>`}</section>` : ''}` : ''}`;
}

function artianPredictView(p: Profile) {
  if (!skillPosition(p)) return '<section class="card empty"><h2>尚未确定共同种子</h2><p>请先导入或识别种子，再定位普通机械武器制作计数器。</p></section>';
  const state = artianState(p);
  const result = artianPrediction?.profile === p.id && artianPrediction.seed === state.seed && artianPrediction.start === state.counters[artianPrediction.weapon] ? artianPrediction : null;
  return `<section class="card"><h3>普通机械武器复原加成 · R8</h3><p>使用各武器独立的制作计数器；每行表示下一把新制作武器的完整五槽。</p><p>${Object.entries(state.counters).map(([weapon, counter]) => `${weapons[Number(weapon)]}：${counter}`).join(' · ') || '尚未定位任何武器的制作计数器'}</p>${button('定位／修改制作计数器', 'artian-observe', '', 'small')}</section>
    <details class="card filters-card" ${result ? '' : 'open'}><summary>筛选</summary><form data-form="artian-predict"><div class="grid"><label>武器种类<select name="weapon">${weapons.flatMap((name, weapon) => state.counters[weapon] === undefined ? [] : [`<option value="${weapon}" ${weapon === result?.weapon ? 'selected' : ''}>${name}</option>`]).join('')}</select></label>${select('属性 / 异常', 'attribute', attributes, result?.attribute ?? state.session?.attribute ?? 0)}</div><fieldset class="requirements"><legend>加成需求 <span class="muted">选填 · 不限顺序</span></legend><div class="slots">${Array.from({ length: 5 }, (_, i) => `<label><span class="slot-number" aria-hidden="true">0${i + 1}</span><select name="requirement${i}" aria-label="加成需求 ${i + 1}"><option value="0">不限</option>${artianBonuses.map((b) => `<option value="${b.id}" ${result?.requirements[i] === b.id ? 'selected' : ''}>${b.name}</option>`).join('')}</select></label>`).join('')}</div></fieldset>${field('向后预测次数', 'count', String(result?.count ?? 1000), 'number', 'min="1" max="10000" step="1" required')}<div class="actions">${submit('生成预测')}</div></form></details>
    ${result ? `<section class="card"><h3>${weapons[result.weapon]} · ${attributes[result.attribute]}</h3><p>${result.rows.length} 条匹配 / ${result.count} 把</p>${result.rows.length ? result.rows.slice(result.page * 30, (result.page + 1) * 30).map((r) => `<article class="future-row"><h3>再制作 ${r.counter - result.start + 1} 把 · 制作位置 ${r.counter}</h3>${artianChips(r.roll)}</article>`).join('') : '<p>没有匹配结果，请调整条件或范围。</p>'}</section>${predictionPager('artian-page', result.page, result.rows.length)}` : ''}`;
}

function skillPredictView(p: Profile) {
  const position = skillPosition(p);
  if (!position || position.skill === null) return `<section class="card empty"><h2>尚未确认技能位置</h2><p>${position ? '种子已知，只需到技能观星中定位技能计数器。' : '请先导入种子或通过观星确定种子，再定位技能计数器。'}</p>${button('前往技能观星', 'skill-observe', '', 'primary')}</section>`;
  const result = skillPrediction?.profile === p.id && skillPrediction.seed === position.seed && skillPrediction.start === position.skill ? skillPrediction : null;
  return `
    <details class="card filters-card" ${result ? '' : 'open'}><summary>筛选技能组合</summary><form data-form="skill-predict"><div class="grid">${select('武器种类', 'weapon', weapons, result?.weapon ?? 0)}${select('属性 / 异常', 'attribute', attributes, result?.attribute ?? 0)}${multiSelect('系列技能', 'set', skillSets, result?.set ?? [])}${multiSelect('组合技能', 'group', skillGroups, result?.group ?? [])}</div><p class="muted">每类可多选，命中其中一项即可；两类条件同时满足。未选择表示不限。</p>${number('向后预测次数', 'count', String(result?.count ?? 1000), 10000)}${submit('生成技能预测')}</form></details>
    ${result ? `<section class="card"><h3>${weapons[result.weapon]} · ${attributes[result.attribute]}</h3><p>${result.rows.length} 条匹配 / ${result.count} 抽</p>${result.rows.length ? result.rows.slice(result.page * 30, (result.page + 1) * 30).map((r) => `<article class="future-row skill-row"><div><h3>再抽 ${r.counter - result.start + 1} 次 · 技能位置 ${r.counter}</h3></div><div class="chips"><span class="bonus">${escape(skillSets[r.set])}</span><span class="bonus">${escape(skillGroups[r.group])}</span></div></article>`).join('') : '<p class="empty">没有匹配结果，试试调整条件或范围。</p>'}</section>${predictionPager('skill-page', result.page, result.rows.length)}` : ''}`;
}

function skillSampleFields(sample?: number) {
  return `<div class="grid">${select('系列技能', 'set', ['请选择', ...skillSets], sample === undefined ? 0 : Math.floor(sample / 14) + 1)}${select('组合技能', 'group', ['请选择', ...skillGroups], sample === undefined ? 0 : sample % 14 + 1)}</div>`;
}

function skillSamplingView(p: Profile) {
  const position = skillPosition(p);
  const s = p.skillSession?.seed === position?.seed ? p.skillSession : null;
  const fixed = s?.synced || (position !== null && position.skill !== null);
  const setup = `<form data-form="${s ? 'skill-sampling-change' : 'skill-sampling'}"><div class="grid">${select('武器种类', 'weapon', weapons, s?.weapon ?? 0)}${select('属性 / 异常', 'attribute', attributes, s?.attribute ?? 0)}</div>${s ? '<p class="muted">选择后自动保存，保留技能样本，修改后需重新搜索位置。</p>' : `${check('saved', '我已在采样前保存游戏，能够回到这个基线')}${submit('设置采样武器')}`}</form>`;
  return `${!fixed ? `<section class="card"><h3>采样武器</h3><p>先保存游戏，再连续重置技能。已有武器上的旧技能不能作为下一抽样本。</p>${setup}</section>` : ''}
    ${s && !s.synced ? `<section class="card sample-card${s.rolls.length ? '' : ' solo'}"><h3>${editSkillSample !== null ? `修改第 ${editSkillSample + 1} 抽` : s.candidate !== null ? '已选用技能位置' : `录入第 ${s.rolls.length + 1} 抽`}</h3><p>${weapons[s.weapon]} · ${attributes[s.attribute]} · 连续记录，至少两抽，建议四抽以上。</p>${s.candidate === null || editSkillSample !== null ? `<form data-form="skill-sample">${skillSampleFields(editSkillSample === null ? undefined : s.rolls[editSkillSample])}<div class="actions">${submit(editSkillSample === null ? '保存这一抽' : '保存修改')}${editSkillSample !== null ? button('取消修改', 'skill-edit-cancel') : ''}</div></form>` : '<p>可直接在上方确认游戏位置，无需再录入样本。额外一抽验证为可选操作。</p>'}
    ${s.candidate !== null && !s.verified && editSkillSample === null ? `<details><summary>用新抽取的额外一抽验证候选</summary><p>以下一抽须紧接已录的 ${s.rolls.length} 抽之后，不能重复填写旧结果。验证成功会追加这条样本。</p><form data-form="skill-verify">${skillSampleFields()}${submit('核对额外一抽')}</form></details>` : ''}</section>` : ''}
    ${fixed ? '<p class="notice">已进入正式位置。新一轮采样请建立新档案，避免混入当前执行记录。</p>' : ''}
    ${s?.rolls.length ? `<section class="card records-card${s.synced ? ' solo' : ''}"><h3>观测记录 <span class="count">${s.rolls.length}</span></h3><div class="records-list">${s.rolls.map((id, i) => `<article class="sample"><b>${String(i + 1).padStart(2, '0')}</b><div class="chips"><span class="bonus">${escape(skillSets[Math.floor(id / 14)])}</span><span class="bonus">${escape(skillGroups[id % 14])}</span></div>${!s.synced ? button('修改', 'skill-edit', String(i), 'small') : ''}</article>`).join('')}</div>${!s.synced ? button('删除最后一抽', 'skill-delete-sample', '', 'small text-button') : ''}</section>` : ''}
    ${s && !s.synced && !s.verified ? `<section class="card"><h3>搜索技能位置</h3><p>共同种子 ${s.seed}</p><form data-form="skill-search"><div class="grid">${number('起始位置下界', 'start', String(s.search?.start ?? 0))}${number('起始位置上界', 'end', String(s.search?.end ?? 9999))}</div>${submit('开始搜索')}</form></section>` : ''}
    ${s?.search ? `<section class="card"><h3>最近搜索任务</h3><p>种子 ${s.seed} · 位置 ${s.search.start}–${s.search.end}</p><p><b>范围完成</b> · ${s.search.candidates.length} 个候选</p>${s.verified ? '<p class="notice">✓ 已通过额外一抽校准。</p>' : !s.search.candidates.length ? '<p class="notice">本范围内零候选。请检查技能对、武器属性、连续性与范围。</p>' : s.search.candidates.length > 1 ? '<p class="notice">有多个候选，建议追加连续样本，再以相同范围重新搜索。</p>' : '<p class="notice">本次范围内唯一，不代表所有范围内唯一。选用后可直接确认位置，也可额外一抽核对。</p>'}${s.search.candidates.slice(0, 30).map((counter) => `<div class="candidate"><span>种子 <b>${s.seed}</b> / 起始位置 <b>${counter}</b></span>${!s.verified && !s.synced ? button(s.candidate === counter ? '已选用' : '选用', 'skill-candidate', String(counter), 'small') : '<span class="muted">历史候选</span>'}</div>`).join('')}${s.search.candidates.length > 30 ? '<p>仅展示前 30 个候选，请补充样本缩小范围。</p>' : ''}</section>` : ''}
    `;
}

function bonusPredictView(p: Profile) {
  if (!p.state) return `<section class="card empty"><h2>尚未确认抽取位置</h2>${button('前往观星', 'tab', 'observe', 'primary')}</section>`;
  const tracks = `<div class="actions prediction-tracks" role="group" aria-label="复原方式">${button('重置', 'bonus-operation', 'reset', bonusOperation === 'reset' ? 'primary' : '')}${button('不重置', 'bonus-operation', 'keep', bonusOperation === 'keep' ? 'primary' : '')}</div>`;
  if (bonusOperation === 'keep') return tracks + keepPredictView(p);
  const draft = predictionDrafts.get(p.id) ?? { weapon: 0, attribute: 0 };
  predictionDrafts.set(p.id, draft);
  const rows = prediction?.rows.slice(prediction.page * 30, (prediction.page + 1) * 30) ?? [];
  return `${tracks}
    <details class="card filters-card" ${prediction ? '' : 'open'}><summary>筛选</summary><form data-form="predict"><div class="grid">${select('武器种类', 'weapon', weapons, draft.weapon)}${select('属性 / 异常', 'attribute', attributes, draft.attribute)}</div><fieldset class="requirements"><legend>加成需求 <span class="muted">选填 · 不限顺序</span></legend><div class="slots">${Array.from({ length: 5 }, (_, i) => `<label><span class="slot-number" aria-hidden="true">0${i + 1}</span><select name="requirement${i}" aria-label="加成需求 ${i + 1}"><option value="0">不限</option>${bonuses.map((b) => `<option value="${b.id}" ${prediction?.requirements[i] === b.id ? 'selected' : ''}>${b.name}</option>`).join('')}</select></label>`).join('')}</div></fieldset>${number('向后预测次数', 'count', String(prediction?.limit ?? 1000), 10000)}<div class="actions">${submit('生成预测')}</div></form></details>
    ${prediction ? `<section class="card"><h3>${escape(prediction.name)} <span class="muted">${prediction.rows.length} 条匹配 / ${prediction.limit} 抽</span></h3>${rows.length ? rows.map((r) => `<article class="future-row"><div><h3>再抽 ${r.counter - p.state!.counter + 1} 次 · 位置 ${r.counter}</h3></div>${chips(r.roll)}</article>`).join('') : '<p class="empty">没有匹配结果，试试调整条件或范围。</p>'}</section>${predictionPager('page', prediction.page, prediction.rows.length)}` : ''}`;
}

function keepPredictView(p: Profile) {
  const result = keepPrediction?.profile === p.id && keepPrediction.seed === p.state!.seed && keepPrediction.start === p.state!.counter ? keepPrediction : null;
  return `<details class="card filters-card" ${result ? '' : 'open'}><summary>当前构成与筛选</summary><form data-form="keep-predict"><div class="grid">${select('武器种类', 'weapon', weapons, result?.weapon ?? 0)}${select('属性 / 异常', 'attribute', attributes, result?.attribute ?? 0)}</div><fieldset class="requirements"><legend>当前五槽类别（按顺序从上到下）</legend><div class="slots">${Array.from({ length: 5 }, (_, i) => `<label><span class="slot-number">0${i + 1}</span><select name="layout${i}" aria-label="当前第 ${i + 1} 槽类别" required><option value="">请选择</option>${['攻击', '会心', '属性', '斩味／装填'].map((name, category) => `<option value="${category}" ${result?.layout[i] === category ? 'selected' : ''}>${name}</option>`).join('')}</select></label>`).join('')}</div></fieldset><p class="muted">保留每槽类别及顺序，只重新抽取等级。无需填写当前等级；与重置共用复原计数器。</p><fieldset class="requirements"><legend>目标加成（选填 · 不限顺序）</legend><div class="slots">${Array.from({ length: 5 }, (_, i) => `<label><span class="slot-number">0${i + 1}</span><select name="requirement${i}" aria-label="不重置加成需求 ${i + 1}"><option value="0">不限</option>${bonuses.map((b) => `<option value="${b.id}" ${result?.requirements[i] === b.id ? 'selected' : ''}>${b.name}</option>`).join('')}</select></label>`).join('')}</div></fieldset>${field('向后预测次数', 'count', String(result?.count ?? 1000), 'number', 'min="1" max="10000" step="1" required')}${submit('生成不重置预测')}</form></details>
    ${result ? `<section class="card"><h3>${weapons[result.weapon]} · ${attributes[result.attribute]} <span class="muted">${result.rows.length} 条匹配 / ${result.count} 抽</span></h3>${result.rows.length ? result.rows.slice(result.page * 30, (result.page + 1) * 30).map((row) => `<article class="future-row"><div><h3>再抽 ${row.counter - result.start + 1} 次 · 复原位置 ${row.counter} · 不重置</h3></div>${chips(row.roll)}</article>`).join('') : '<p class="empty">没有匹配结果，试试调整条件或范围。</p>'}</section>${predictionPager('keep-page', result.page, result.rows.length)}` : ''}`;
}

function predictionName(weapon: number, attribute: number) {
  return `${weapons[weapon]} · ${attributes[attribute]}`;
}

function tableView(p: Profile) {
  const gate = predictionGate(p, 'skill');
  if (gate) return gate;
  const start = skillPosition(p)?.skill;
  if (start === null || start === undefined) return `<section class="card empty"><h2>尚未确定技能位置</h2><p>确定当前位置后即可查看完整预测表。</p>${button('前往观星', 'skill-observe', '', 'primary')}</section>`;
  if (start === 0xffffffff) return `<section class="card empty"><h2>已到达位置上限</h2><p>请核对当前计数器后再生成预测。</p>${button('前往观星', 'skill-observe', '', 'primary')}</section>`;
  return skillTableView(p);
}

function skillTableView(p: Profile) {
  const position = skillPosition(p)!;
  if (!skillTablePrediction || skillTablePrediction.profile !== p.id || skillTablePrediction.seed !== position.seed || skillTablePrediction.start !== position.skill) {
    const previous = skillTablePrediction?.profile === p.id ? skillTablePrediction.filter : null;
    skillTablePrediction = { ...skillTableForecast(position, { weapons: previous?.weapons ?? [{ weapon: 0, attribute: 0 }], count: Math.min(previous?.count ?? 1000, 0xffffffff - position.skill!), set: previous?.set ?? 0, group: previous?.group ?? 0, operator: previous?.operator ?? 'AND', highlight: previous?.highlight ?? true, filterMatches: previous?.filterMatches ?? false }), profile: p.id, page: 0 };
  }
  const result = skillTablePrediction;
  const columns = result.columns.slice(result.page * 30, (result.page + 1) * 30);
  const pages = Math.max(1, Math.ceil(result.columns.length / 30));
  const cell = (value: typeof columns[number]['cells'][number]) => `<td class="${result.filter.highlight && value.matches ? 'skill-match' : ''}"><div class="skill-table-set">${escape(skillSets[value.set])}</div><div class="skill-table-group">${escape(skillGroups[value.group])}</div></td>`;
  const heading = (weapon: typeof result.filter.weapons[number]) => `${weapons[weapon.weapon]}<br><span class="muted">${attributes[weapon.attribute]}</span>`;
  const table = skillTableVertical
    ? `<thead><tr><th scope="col">再抽次数</th><th scope="col">技能位置</th>${result.filter.weapons.map((w) => `<th scope="col">${heading(w)}</th>`).join('')}</tr></thead><tbody>${columns.map((c) => `<tr><th scope="row">${c.counter - result.start + 1}</th><td class="skill-counter">${c.counter}</td>${c.cells.map(cell).join('')}</tr>`).join('')}</tbody>`
    : `<thead><tr><th scope="row">再抽次数</th>${columns.map((c) => `<th scope="col">${c.counter - result.start + 1}</th>`).join('')}</tr><tr><th scope="row">技能位置</th>${columns.map((c) => `<th scope="col">${c.counter}</th>`).join('')}</tr></thead><tbody>${result.filter.weapons.map((w, i) => `<tr><th scope="row">${heading(w)}</th>${columns.map((c) => cell(c.cells[i]!)).join('')}</tr>`).join('')}</tbody>`;
  return `
    <details class="card filters-card" open><summary>武器与筛选</summary><h3>已添加武器 <span class="count">${result.filter.weapons.length} / 140</span></h3>
    <div class="skill-table-weapons">${result.filter.weapons.map((w, i) => `<div class="candidate"><span>${weapons[w.weapon]} · ${attributes[w.attribute]}</span><button type="button" class="small" data-action="skill-table-remove" data-value="${i}" ${result.filter.weapons.length === 1 ? 'data-unavailable disabled' : ''} aria-label="移除${weapons[w.weapon]}${attributes[w.attribute]}">移除</button></div>`).join('')}</div>
    <form data-form="skill-table-weapon"><div class="grid">${select('武器种类', 'weapon', weapons, 0)}${select('属性 / 异常', 'attribute', attributes, 0)}</div>${submit('添加到表格')}</form>
    <form data-form="skill-table-filter"><div class="skill-filter-grid">${select('系列技能', 'set', skillSets, result.filter.set)}<label>条件<select name="operator"><option value="OR" ${result.filter.operator === 'OR' ? 'selected' : ''}>OR</option><option value="AND" ${result.filter.operator === 'AND' ? 'selected' : ''}>AND</option></select></label>${select('组合技能', 'group', skillGroups, result.filter.group)}</div><div class="actions"><label class="check"><input type="checkbox" name="highlight" ${result.filter.highlight ? 'checked' : ''}>高亮符合条件的</label><label class="check"><input type="checkbox" name="filterMatches" ${result.filter.filterMatches ? 'checked' : ''}>筛选符合条件的</label></div>${number('向后预测次数', 'count', String(result.filter.count), 10000)}<p class="muted">AND：两项均命中；OR：任一项命中。高亮与筛选独立控制；筛选时保留任一武器命中的位置，同列保留所有武器结果。每格上方为系列技能，下方为组合技能。</p><div class="actions">${submit('更新预测表')}</div></form></details>
    <section id="forecast-results"><div class="section-heading"><h3>${result.filter.weapons.length} 把武器 · 起始技能位置 ${result.start}</h3><div class="actions">${button(skillTableVertical ? '转为横向' : '转为纵向', 'skill-table-orientation', '', 'small')}${button('导出 CSV', 'table-export', 'skill', 'small')}${button('导出 Excel', 'table-excel', 'skill', 'small')}</div></div><p>${result.matchingCount} 个匹配位置 / ${result.filter.count} 抽 · 显示 ${result.columns.length} ${skillTableVertical ? '行' : '列'} · 每页 30 ${skillTableVertical ? '行' : '列'}，左右滑动查看</p>
    ${columns.length ? `<div class="forecast-scroll" role="region" aria-label="多武器技能预测表" tabindex="0"><table class="forecast-table skill-forecast-table${skillTableVertical ? ' skill-table-vertical' : ''}"><caption class="sr-only">从技能位置 ${result.start} 开始，各武器的系列技能与组合技能</caption>${table}</table></div>` : '<p class="empty">没有匹配结果，试试添加其他武器、放宽条件或扩大预测范围。</p>'}
    <div class="log-pagination" role="group" aria-label="技能预测表分页"><button type="button" class="small" data-action="skill-table-page" data-value="-1" ${result.page === 0 ? 'data-unavailable disabled' : ''}>上一页</button><span class="muted" aria-live="polite">${result.page + 1} / ${pages}</span><button type="button" class="small" data-action="skill-table-page" data-value="1" ${result.page + 1 >= pages ? 'data-unavailable disabled' : ''}>下一页</button></div></section>`;
}

function demandPlanView(p: Profile) {
  const pending = p.demands.filter((d) => !d.achieved);
  const bonus = pending.filter((d) => d.bonusEnabled);
  const skills = pending.filter((d) => d.skills !== null);
  const position = skillPosition(p);
  const route = p.state && bonus.length ? shortestRoute(p.state, bonus, p.planRange) : null;
  const skillRoute = position && position.skill !== null && skills.length ? shortestSkillRoute(position, skills, p.planRange) : null;
  return `<details class="card filters-card" open><summary>添加武器需求</summary><form data-form="plan-demand">${field('武器名称（选填）', 'name', '', 'text', 'maxlength="80" placeholder="默认使用武器种类与属性"')}<div class="grid">${select('武器种类', 'weapon', weapons, 0)}${select('属性 / 异常', 'attribute', attributes, 0)}</div>
    <label class="check"><input type="checkbox" name="bonusEnabled" checked>规划复原加成</label><fieldset class="requirements" data-demand-fields="bonus"><legend>复原加成需求 <span class="muted">不限顺序 · 同类向高级匹配</span></legend><div class="slots">${Array.from({ length: 5 }, (_, i) => `<label><span class="slot-number">0${i + 1}</span><select name="requirement${i}" aria-label="计划加成需求 ${i + 1}"><option value="0">不限</option>${bonuses.map((b) => `<option value="${b.id}">${b.name}</option>`).join('')}</select></label>`).join('')}</div></fieldset>
    <label class="check"><input type="checkbox" name="skillsEnabled" checked>规划技能组合</label><fieldset data-demand-fields="skills"><legend>技能组合需求（指定项均需命中）</legend><div class="grid">${select('系列技能', 'set', ['不限', ...skillSets], 0)}${select('组合技能', 'group', ['不限', ...skillGroups], 0)}</div></fieldset>${field('向后搜索次数（两条路径共用）', 'planRange', String(p.planRange), 'number', 'min="1" max="10000" step="1" required')}<p class="muted">范围修改后即时生效，最多 10,000 次，分别从当前复原／技能位置开始。每条需求代表一把武器，可只规划其中一项。</p>${submit('添加需求')}</form></details>
    <section class="card"><h3>已保存需求 <span class="count">${p.demands.length}</span></h3>${p.demands.length ? p.demands.map((d) => `<article class="future-row demand-row"><div><b>${escape(d.name)}</b><p>${weapons[d.weapon]} · ${attributes[d.attribute]}${d.achieved ? ' · 已获得' : ''}</p></div><div>${d.bonusEnabled ? d.requirements.some(Boolean) ? chips(d.requirements.filter(Boolean)) : '<p>加成不限</p>' : '<p>未规划</p>'}</div><div>${d.skills ? `<div class="chips"><span class="bonus">${escape(d.skills.set === null ? '系列技能不限' : skillSets[d.skills.set])}</span><span class="bonus">${escape(d.skills.group === null ? '组合技能不限' : skillGroups[d.skills.group])}</span></div>` : '<p>未规划</p>'}</div>${button('删除', 'remove-demand', d.id, 'small')}</article>`).join('') : '<p>在上方添加需求，每条需求对应一把武器。</p>'}</section>
    <section class="card" id="plan-routes"><div class="actions prediction-tracks" role="group" aria-label="强化路径类型">${(['bonus', 'skill'] as const).map((track) => `<button type="button" data-action="plan-track" data-value="${track}" aria-pressed="${planTrack === track}" class="${planTrack === track ? 'primary' : ''}">${track === 'bonus' ? '复原加成' : '技能组合'}</button>`).join('')}</div>
    <div data-plan-track="bonus" ${planTrack === 'bonus' ? '' : 'hidden'}>${!bonus.length ? '<p>暂无待规划的复原加成需求。</p>' : !route ? `<p>请先定位复原计数器。</p>${button('定位复原计数器', 'bonus-observe', '', 'small')}` : `${!route.complete ? `<p>向后搜索 ${route.searched} 次，已找到 ${route.steps.length} / ${bonus.length} 把武器。未找到：${route.missing!.map((d) => escape(d.name)).join('、')}。</p>` : ''}${route.steps.length ? `<p>从复原位置 ${p.state!.counter} 起，共 ${route.total} 次完全重抽，其中 ${route.total - route.steps.length} 次垫刀。</p><ol class="route-list">${route.steps.map((step) => `<li>${step.padding ? `<p>先垫刀 <b>${step.padding}</b> 次</p>` : ''}<b>${escape(step.demand.name)}</b><p>${weapons[step.demand.weapon]} · ${attributes[step.demand.attribute]} · 复原位置 ${step.counter}<br>完全重抽 1 次，保留以下加成</p>${chips(step.roll)}</li>`).join('')}</ol>` : '<p>当前范围内暂无可安排的复原加成路径，请调整需求或当前位置。</p>'}`}</div>
    <div data-plan-track="skill" ${planTrack === 'skill' ? '' : 'hidden'}>${!skills.length ? '<p>暂无待规划的技能组合需求。</p>' : !skillRoute ? `<p>请先定位技能计数器。</p>${button('定位技能计数器', 'skill-observe', '', 'small')}` : !skillRoute.complete ? `<p>向后搜索 ${skillRoute.searched} 次，未找到满足全部技能需求的路径。请调整需求或当前位置。</p>` : `<p>从技能位置 ${position!.skill} 起，共 ${skillRoute.total} 次技能重置，其中 ${skillRoute.total - skills.length} 次垫刀。</p><ol class="route-list">${skillRoute.steps.map((step) => `<li>${step.padding ? `<p>先用其他武器重置技能 <b>${step.padding}</b> 次</p>` : ''}<b>${escape(step.demand.name)}</b><p>${weapons[step.demand.weapon]} · ${attributes[step.demand.attribute]} · 技能位置 ${step.counter}</p><div class="chips"><span class="bonus">${escape(skillSets[step.roll.set])}</span><span class="bonus">${escape(skillGroups[step.roll.group])}</span></div></li>`).join('')}</ol>`}</div></section>
    <p class="muted">两条路径分别按总操作次数最少计算，各向后搜索最多 10,000 次；同一计数器位置只能分配给一把武器。垫刀请使用其他武器，避免改动已完成的结果。</p>`;
}

function planView(p: Profile) {
  return demandPlanView(p);
}

function render() {
  const p = current();
  const view = entry || !p ? 'entry' : tab;
  const key = `${view}-${p?.id ?? ''}`;
  const focused = document.activeElement instanceof HTMLButtonElement ? document.activeElement : null;
  app.innerHTML = `<div class="shell${p && !entry ? ' has-navigation' : ''}"><header><a href="#" data-action="home" class="brand"><span class="brand-icon" aria-hidden="true"><svg viewBox="0 0 32 32" fill="none"><circle cx="16" cy="16" r="13"/><path d="M16 2L19.5 12.5L30 16L19.5 19.5L16 30L12.5 19.5L2 16L12.5 12.5Z"/></svg></span><span>巨戟观星</span></a>${button('关于', 'about', '', 'small text-button')}</header><div id="message" role="status" aria-live="polite" hidden></div>
    <div id="workspace">${entry !== 'about' ? `<div class="toolbar">${archive.profiles.length ? `<label><select id="profile-select" aria-label="当前档案">${archive.profiles.map((item) => `<option value="${escape(item.id)}" ${item.id === archive.active ? 'selected' : ''}>${escape(item.name)}</option>`).join('')}</select></label>` : ''}<div class="actions">${button('+ 新档案', 'entry', 'new', 'small')}${button('导入', 'entry', 'import', 'small')}${archive.profiles.length ? button('管理', 'entry', 'manage', 'small') : ''}</div></div>` : ''}
    ${!entry && p ? `<nav aria-label="主导航">${[
      ['observe', '观星', '<circle cx="12" cy="12" r="8"/><path d="m12 5 2 5 5 2-5 2-2 5-2-5-5-2 5-2z"/>'],
      ['predict', '预测', '<path d="M4 18V6m8 12V6m8 12V6M2 9h4m4 6h4m4-4h4"/>'],
      ['table', '技能预测表', '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 10h18M3 15h18M9 4v16"/>'],
      ['plan', '计划', '<path d="M9 5h11M9 12h11M9 19h11M2 5l1 1 2-2M2 12l1 1 2-2M2 19l1 1 2-2"/>'],
    ].map(([id, label, paths]) => button(`<svg viewBox="0 0 24 24" aria-hidden="true">${paths}</svg><span>${label}</span>`, 'tab', id, tab === id ? 'active' : '')).join('')}</nav>` : ''}
    <div class="view view-${view}${key !== renderedView ? ' enter' : ''}${view === 'predict' && prediction ? ' has-results' : ''}">${entry || !p ? entryView() : tab === 'observe' ? observe(p) : tab === 'predict' ? predictView(p) : tab === 'table' ? tableView(p) : planView(p)}</div>
    </div>
    </div>`;
  mountSelectors(app);
  if (p?.tasks.at(-1)) progressView(p.tasks.at(-1)!);
  renderedView = key;
  lock();
  if (focused?.dataset.action) {
    const replacement = [...app.querySelectorAll<HTMLButtonElement>('button[data-action]')].find((el) => el.dataset.action === focused.dataset.action && el.dataset.value === focused.dataset.value);
    replacement?.focus({ preventScroll: true });
  }
}

function lock() {
  app.querySelectorAll<HTMLButtonElement | HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>('button,input,select,textarea').forEach((el) => {
    el.disabled = busy || el.hasAttribute('data-unavailable') || (searching && el.dataset.action !== 'pause');
  });
}

async function startSearch() {
  const p = current()!;
  const task = p.tasks.at(-1)!;
  if (task.status !== 'paused' || task.weapon !== p.sampling.weapon || task.attribute !== p.sampling.attribute || JSON.stringify(task.rolls) !== JSON.stringify(p.rolls)) throw new Error('此任务不能续搜，请建立新任务');
  searching = true; stop = false; busy = false; render();
  await runSearch(task, {
    stopped: () => stop,
    progress: progressView,
    save: async (saved) => { await update({ ...current()!, tasks: [...current()!.tasks.slice(0, -1), saved] }); },
  }).finally(() => { searching = false; render(); });
}

async function addProfile(p: Profile) {
  if (archive.profiles.length >= 30) throw new Error('最多保存 30 个档案，请先导出整理');
  await commit({ ...archive, profiles: [...archive.profiles, p], active: p.id });
  entry = ''; tab = p.state ? 'predict' : 'observe'; prediction = null; preview = null; editSample = null; editSkillSample = null;
}

async function handleForm(form: HTMLFormElement, intent?: string) {
  const data = new FormData(form);
  lock();
  const text = (name: string) => String(data.get(name) ?? '').trim();
  const num = (name: string) => { if (!text(name)) throw new Error('请填写完整数值'); return uint.parse(Number(text(name))); };
  const p = current();
  const type = form.dataset.form;
  if (type === 'profile-edit') {
    const profile = archive.profiles.find((item) => item.id === form.dataset.profile);
    if (!profile) throw new Error('存档不存在');
    const restored = profile.state ? setCounter(profile, num('counter')) : profile;
    const skill = text('skill') ? num('skill') : null;
    const next = skill !== null && skill !== skillPosition(profile)?.skill ? setSkillCounter(restored, skill) : restored;
    await update(profileSchema.parse({ ...next, name: text('name') }));
    prediction = null;
    skillPrediction = null;
    editSkillSample = null;
    render();
    message('档案已更新');
    return;
  }
  if (type === 'preview') { preview = parseCode(text('code')); render(); return; }
  if (type === 'new' || type === 'import') {
    if (type === 'import' && !preview) throw new Error('请先解析有效的续接码');
    const next = newProfile(text('name'));
    await addProfile(type === 'import' ? { ...next, state: preview, baseline: preview, seedHint: preview!.seed, skillHint: preview!.skill, calibrated: true, aligned: true } : { ...next, platform: text('platform') || '未填写', gameVersion: text('gameVersion') || '未知' });
    render(); return;
  }
  if (type === 'manual') {
    const seed = num('seed');
    const state = text('counter') ? { seed, counter: num('counter'), skill: text('skill') ? num('skill') : null } : null;
    await addProfile({ ...newProfile('手动导入档案'), state, baseline: state, seedHint: seed, skillHint: text('skill') ? num('skill') : null, calibrated: state !== null, aligned: state !== null });
    render(); return;
  }
  if (type === 'backup') {
    const backup = archiveSchema.parse(JSON.parse(text('json')));
    if (archive.profiles.length + backup.profiles.length > 30) throw new Error('导入后超过 30 个档案');
    const profiles = backup.profiles.map((item) => ({ ...item, id: crypto.randomUUID(), aligned: false }));
    await commit({ ...archive, profiles: [...archive.profiles, ...profiles], active: profiles[0]?.id ?? archive.active });
    entry = ''; prediction = null; render(); return;
  }
  if (!p) throw new Error('请先建立档案');
  if (type === 'artian-weapon') {
    const drafts = [...app.querySelectorAll<HTMLInputElement | HTMLSelectElement>('form[data-form="artian-sample"] [name], form[data-form="artian-search"] [name]')].map((input) => ({ form: input.form!.dataset.form!, name: input.name, value: input.value }));
    try {
      await update(setArtianSampling(p, num('weapon'), num('attribute')));
      artianPrediction = null;
    } finally {
      render();
      drafts.forEach((draft) => {
        const input = app.querySelector<HTMLInputElement | HTMLSelectElement>(`form[data-form="${draft.form}"] [name="${draft.name}"]`);
        if (!input) return;
        input.value = draft.value;
        if (input instanceof HTMLSelectElement) {
          if (input.selectedIndex < 0) input.value = '';
          input.dispatchEvent(new Event('change'));
        }
      });
    }
    message('采样武器已保存');
    return;
  }
  if (type === 'artian-sample') {
    const roll = Array.from({ length: 5 }, (_, i) => num(`slot${i}`));
    await update(artianEdit?.profile === p.id ? editArtianSample(p, artianEdit.index, roll) : recordArtianSample(p, roll));
    artianEdit = null;
  }
  if (type === 'artian-search') await update(searchArtianCounter(p, num('start'), num('end')));
  if (type === 'artian-align') {
    const aligned = alignArtianCounter(p, num('candidate'), z.enum(['baseline', 'sampled']).parse(text('mode')) === 'sampled');
    const state = artianState(aligned);
    const nextWeapon = weapons.findIndex((_, weapon) => state.counters[weapon] === undefined);
    await update(nextWeapon < 0 ? aligned : setArtianSampling(aligned, nextWeapon, state.session!.attribute ? 1 : 0));
    artianEdit = null;
  }
  if (type === 'artian-predict') {
    const state = artianState(p);
    const input = artianParameters.extend({ count: uint.min(1).max(10000) }).parse({ weapon: num('weapon'), attribute: num('attribute'), count: num('count') });
    const start = state.counters[input.weapon];
    if (start === undefined) throw new Error('请先到普通机械武器观星中定位该武器的制作计数器');
    if (start + input.count > 1000000) throw new Error('预测范围须在制作位置 1,000,000 以内');
    const requirements = Array.from({ length: 5 }, (_, i) => num(`requirement${i}`));
    const pool = artianPool(input.weapon, input.attribute);
    if (requirements.some((id) => id !== 0 && !pool.some((b) => b.id === id)) || pool.some((b) => requirements.filter((id) => id === b.id).length > b.cap)) throw new Error('筛选需求超出该武器加成池或重复上限');
    artianPrediction = { ...input, profile: p.id, seed: state.seed, start, requirements, page: 0,
      rows: predictArtian(state.seed, input.weapon, input.attribute, start, input.count).flatMap((roll, i) =>
        pool.every((b) => roll.filter((id) => id === b.id).length >= requirements.filter((id) => id === b.id).length) ? [{ counter: start + i, roll }] : []),
    };
    render(); return;
  }
  if (type === 'keep-predict') {
    if (!p.state) throw new Error('请先定位复原计数器');
    const input = z.object({ weapon: uint.max(13), attribute: uint.max(9), count: uint.min(1).max(10000) }).parse({ weapon: num('weapon'), attribute: num('attribute'), count: num('count') });
    if (p.state.counter + input.count > 0xffffffff) throw new Error('预测范围不可超出复原位置上限');
    const layout = Array.from({ length: 5 }, (_, i) => num(`layout${i}`));
    const requirements = Array.from({ length: 5 }, (_, i) => num(`requirement${i}`));
    const matches = compileRequirements(requirements);
    keepPrediction = { ...input, profile: p.id, seed: p.state.seed, start: p.state.counter, layout, requirements, page: 0,
      rows: predictKeep(p.state.seed, input.weapon, input.attribute, p.state.counter, input.count, layout)
        .flatMap((roll, i) => matches(roll) ? [{ counter: p.state!.counter + i, roll }] : []),
    };
    render(); return;
  }
  if (type === 'plan-demand') {
    const weapon = num('weapon');
    const attribute = num('attribute');
    await update(profileSchema.parse({ ...p, planRange: num('planRange'), demands: [...p.demands, {
      id: crypto.randomUUID(), name: text('name') || `${weapons[weapon]}·${attributes[attribute]}`, weapon, attribute,
      bonusEnabled: data.has('bonusEnabled'), requirements: Array.from({ length: 5 }, (_, i) => data.has('bonusEnabled') ? num(`requirement${i}`) : 0),
      skills: data.has('skillsEnabled') ? { set: num('set') === 0 ? null : num('set') - 1, group: num('group') === 0 ? null : num('group') - 1 } : null,
    }] }));
    render();
    message('需求已添加，强化路径已更新');
    return;
  }
  if (type === 'skill-table-weapon' || type === 'skill-table-filter') {
    const position = skillPosition(p);
    if (!position || !skillTablePrediction || skillTablePrediction.profile !== p.id) throw new Error('请先打开技能预测表');
    const filter = skillTablePrediction.filter;
    skillTablePrediction = { ...skillTableForecast(position, type === 'skill-table-weapon'
      ? { ...filter, weapons: [...filter.weapons, { weapon: num('weapon'), attribute: num('attribute') }] }
      : { ...filter, set: num('set'), group: num('group'), operator: text('operator'), highlight: data.has('highlight'), filterMatches: data.has('filterMatches'), count: num('count') }), profile: p.id, page: 0 };
    render(); return;
  }
  if (type === 'skill-sampling') {
    if (!data.has('saved')) throw new Error('请确认技能采样前已保存游戏');
    await update(startSkillSampling(p, { weapon: num('weapon'), attribute: num('attribute') }));
    editSkillSample = null;
    skillPrediction = null;
  }
  if (type === 'skill-sampling-change') {
    const drafts = [...app.querySelectorAll<HTMLInputElement | HTMLSelectElement>('form[data-form="skill-sample"] [name], form[data-form="skill-search"] [name]')].map((input) => ({ form: input.form!.dataset.form!, name: input.name, value: input.value }));
    try {
      await update(startSkillSampling(p, { weapon: num('weapon'), attribute: num('attribute') }));
      skillPrediction = null;
    } finally {
      render();
      drafts.forEach((draft) => {
        const input = app.querySelector<HTMLInputElement | HTMLSelectElement>(`form[data-form="${draft.form}"] [name="${draft.name}"]`);
        if (!input) return;
        input.value = draft.value;
        if (input instanceof HTMLSelectElement) input.dispatchEvent(new Event('change'));
      });
    }
    message('技能采样武器已保存');
    return;
  }
  if (type === 'skill-sample' || type === 'skill-verify') {
    const set = uint.min(1).max(skillSets.length).parse(num('set')) - 1;
    const group = uint.min(1).max(skillGroups.length).parse(num('group')) - 1;
    await update(type === 'skill-verify' ? verifySkillSample(p, set * 14 + group) : editSkillSample === null ? recordSkillSample(p, set * 14 + group) : editSkillObservation(p, editSkillSample, set * 14 + group));
    editSkillSample = null;
  }
  if (type === 'skill-search') await update(searchSkillCounter(p, num('start'), num('end')));
  if (type === 'skill-align') {
    if (!data.has('aligned')) throw new Error('请确认游戏实际位置');
    await update(alignSkillCounter(p, z.enum(['baseline', 'sampled']).parse(text('mode')) === 'sampled'));
    skillPrediction = null;
  }
  if (type === 'skill-predict') {
    const position = skillPosition(p);
    if (!position || position.skill === null) throw new Error('请先确定技能位置');
    const input = z.object({
      weapon: uint.max(13), attribute: uint.max(9),
      set: z.array(uint.max(skillSets.length - 1)), group: z.array(uint.max(skillGroups.length - 1)), count: uint.min(1).max(10000),
    }).parse({ weapon: num('weapon'), attribute: num('attribute'), set: data.getAll('set').filter((value) => value !== '').map(Number), group: data.getAll('group').filter((value) => value !== '').map(Number), count: num('count') });
    if (position.skill + input.count > 0xffffffff) throw new Error('预测范围不可超出技能位置上限');
    skillPrediction = { ...input, profile: p.id, seed: position.seed, start: position.skill, page: 0,
      rows: predictSkills(position.seed, input.weapon, input.attribute, position.skill, input.count)
        .map((roll, i) => ({ ...roll, counter: position.skill! + i }))
        .filter((roll) => (!input.set.length || input.set.includes(roll.set)) && (!input.group.length || input.group.includes(roll.group))),
    };
  }
  if (type === 'sampling-weapon') {
    const drafts = [...app.querySelectorAll<HTMLInputElement | HTMLSelectElement>('form[data-form="sample"] [name], form[data-form="verify"] [name], form[data-form="search"] [name]')].map((input) => ({ form: input.form!.dataset.form!, name: input.name, value: input.value }));
    try {
      await update(setSamplingWeapon(p, { weapon: num('weapon'), attribute: num('attribute') }));
      prediction = null;
    } finally {
      // Also restore saved selections on validation/write failure, so visible and searched parameters agree.
      render();
      drafts.forEach((draft) => {
        const input = app.querySelector<HTMLInputElement | HTMLSelectElement>(`form[data-form="${draft.form}"] [name="${draft.name}"]`);
        if (!input) return;
        input.value = draft.value;
        if (input instanceof HTMLSelectElement) {
          if (input.selectedIndex < 0) input.value = '';
          input.dispatchEvent(new Event('change'));
        }
      });
    }
    message('采样武器已保存');
    return;
  }
  if (type === 'sample' || type === 'verify') {
    const sample = Array.from({ length: 5 }, (_, i) => num(`slot${i}`));
    compile(p.sampling.weapon, p.sampling.attribute, [sample]);
    if (type === 'verify') await update(profileSchema.parse(verifySample(p, sample)));
    if (type === 'sample') {
      const rolls = editSample === null ? [...p.rolls, sample] : p.rolls.map((r, i) => i === editSample ? sample : r);
      await update(profileSchema.parse({ ...p, rolls, state: null, baseline: null, calibrated: false, aligned: false, targets: [], checkpoint: null }));
      editSample = null;
    }
  }
  if (type === 'align') {
    await update(text('mode') === 'current' ? { ...p, aligned: true } : align(p, text('mode') === 'sampled'));
  }
  if (type === 'search') {
    if (p.tasks.length >= 20) throw new Error('每档案最多 20 个搜索任务，请导出并建立新档案');
    const task = makeTask(p, { seedStart: num('seedStart'), seedEnd: num('seedEnd'), counterStart: num('counterStart'), counterEnd: num('counterEnd') });
    await update({ ...p, tasks: [...p.tasks, task] });
    await startSearch(); return;
  }
  if (type === 'predict') {
    if (!p.state) throw new Error('请先取得种子与位置');
    const count = num('count');
    if (count < 1 || count > 10000 || p.state.counter + count > 0xffffffff) throw new Error('预测范围为 1–10,000 抽，且不可超出位置上限');
    const weapon = num('weapon'); const attribute = num('attribute');
    const requirements = Array.from({ length: 5 }, (_, i) => num(`requirement${i}`));
    const matches = compileRequirements(requirements);
    if (intent === 'save-demand') {
      await update(profileSchema.parse({ ...p, demands: [...p.demands, { id: crypto.randomUUID(), name: text('name'), weapon, attribute, requirements }] }));
      message('需求已保存，可在计划中查看最短路径');
      return;
    }
    const rows = predict(p.state.seed, weapon, attribute, p.state.counter, count)
      .map((roll, i) => ({ counter: p.state!.counter + i, roll }))
      .filter((r) => matches(r.roll));
    prediction = { weapon, attribute, name: predictionName(weapon, attribute), rows, limit: count, page: 0, requirements };
  }
  if (type === 'target-result') {
    await update(advance(p, 1, z.enum(['accepted', 'rejected', 'mismatch']).parse(text('result')))); prediction = null;
  }
  if (type === 'checkpoint') await update(saveCheckpoint(p));
  if (type === 'restore') { await update(restoreCheckpoint(p)); prediction = null; }
  render(); message(type === 'predict' || type === 'skill-predict' ? '' : '工具记录已保存');
}

async function handleAction(action: string, value: string) {
  if (action === 'bonus-operation') {
    bonusOperation = z.enum(['reset', 'keep']).parse(value);
    render(); return;
  }
  if (action === 'keep-page' && keepPrediction) {
    keepPrediction.page = Math.max(0, Math.min(keepPrediction.page + Number(value), Math.max(0, Math.ceil(keepPrediction.rows.length / 30) - 1)));
    render(); return;
  }
  if (action === 'plan-track') {
    planTrack = z.enum(['bonus', 'skill']).parse(value);
    app.querySelectorAll<HTMLElement>('[data-plan-track]').forEach((panel) => { panel.hidden = panel.dataset.planTrack !== planTrack; });
    app.querySelectorAll<HTMLButtonElement>('[data-action="plan-track"]').forEach((control) => {
      const selected = control.dataset.value === planTrack;
      control.classList.toggle('primary', selected);
      control.setAttribute('aria-pressed', String(selected));
    });
    return;
  }
  if (action === 'skill-table-orientation') {
    skillTableVertical = !skillTableVertical;
    render();
    return;
  }
  if (action === 'table-export' || action === 'table-excel') {
    const result = skillTablePrediction;
    if (!result || result.profile !== archive.active) throw new Error('请先生成预测表');
    const excel = action === 'table-excel';
    lock();
    message(`正在导出 ${excel ? 'Excel' : 'CSV'}…`);
    const saved = await storage.saveFile(`技能预测-${result.seed}-${result.start}-${Date.now()}.${excel ? 'xlsx' : 'csv'}`, async () => {
      if (!excel) return new TextEncoder().encode(skillCsv(result, true));
      const { skillExcel } = await import('./excel');
      return skillExcel(result);
    }, excel ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' : 'text/csv;charset=utf-8');
    message(saved ? `${excel ? 'Excel' : 'CSV'} ${standalone ? '已发起下载' : '已保存'}` : '已取消导出');
    return;
  }
  const p = current();
  if (action === 'pause') { stop = true; return; }
  if (action === 'observe-prediction') { tab = 'predict'; predictionTrack = observeTrack; entry = ''; }
  if (action === 'artian-observe') { tab = 'observe'; observeTrack = 'artian'; entry = ''; }
  if (action === 'artian-prediction') { tab = 'predict'; predictionTrack = 'artian'; entry = ''; }
  if (p && action === 'artian-delete-sample') { await update(recordArtianSample(p, null)); artianEdit = null; }
  if (p && action === 'artian-edit') {
    artianEdit = { profile: p.id, index: uint.parse(Number(value)) };
    render();
    document.querySelector('#artian-sample-card')?.scrollIntoView({ block: 'start' });
    return;
  }
  if (action === 'artian-edit-cancel') artianEdit = null;
  if (action === 'artian-page' && artianPrediction) artianPrediction.page = Math.max(0, Math.min(artianPrediction.page + Number(value), Math.max(0, Math.ceil(artianPrediction.rows.length / 30) - 1)));
  if (action === 'home') { entry = ''; tab = 'observe'; }
  if (action === 'about' && entry !== 'about') { aboutReturn = entry; entry = 'about'; }
  if (action === 'about-back') entry = aboutReturn;
  if (action === 'entry') { entry = value; preview = null; }
  if (action === 'tab') { tab = value; entry = ''; }
  if (action === 'bonus-observe') { tab = 'observe'; observeTrack = 'bonus'; entry = ''; }
  if (action === 'skill-table-page' && skillTablePrediction) {
    skillTablePrediction.page = Math.max(0, Math.min(skillTablePrediction.page + Number(value), Math.max(0, Math.ceil(skillTablePrediction.columns.length / 30) - 1)));
    render(); document.querySelector('#forecast-results')?.scrollIntoView({ block: 'start' }); return;
  }
  if (action === 'skill-table-remove' && p && skillTablePrediction?.profile === p.id) {
    const filter = skillTablePrediction.filter;
    skillTablePrediction = { ...skillTableForecast(skillPosition(p)!, { ...filter, weapons: filter.weapons.filter((_, i) => i !== Number(value)) }), profile: p.id, page: 0 };
  }
  if (action === 'prediction-track') predictionTrack = value;
  if (action === 'observe-track') observeTrack = value;
  if (action === 'skill-observe') { tab = 'observe'; observeTrack = 'skill'; entry = ''; }
  if (action === 'skill-prediction') { tab = 'predict'; predictionTrack = 'skill'; entry = ''; }
  if (action === 'skill-edit') editSkillSample = Number(value);
  if (action === 'skill-edit-cancel') editSkillSample = null;
  if (p && action === 'skill-delete-sample') { await update(recordSkillSample(p, null)); editSkillSample = null; }
  if (p && action === 'skill-candidate') { await update(selectSkillCandidate(p, uint.parse(Number(value)))); editSkillSample = null; }
  if (action === 'skill-page' && skillPrediction) skillPrediction.page = Math.max(0, Math.min(skillPrediction.page + Number(value), Math.ceil(skillPrediction.rows.length / 30) - 1));
  if (action === 'confirm-delete-profile') deletingProfile = value;
  if (action === 'cancel-delete-profile') deletingProfile = '';
  if (action === 'delete-profile') {
    await commit(deleteProfile(archive, value));
    predictionDrafts.delete(value);
    logPages.delete(value);
    deletingProfile = ''; prediction = null; preview = null; editSample = null; editSkillSample = null;
    if (!archive.profiles.length) entry = 'new';
  }
  if (action === 'edit') editSample = Number(value);
  if (action === 'edit-cancel') editSample = null;
  if (p && action === 'delete-sample') {
    await update({ ...p, rolls: p.rolls.slice(0, -1), state: null, baseline: null, calibrated: false, aligned: false, targets: [], checkpoint: null }); editSample = null;
  }
  if (p && action === 'candidate') { await update(useCandidate(p, p.tasks.at(-1)!, Number(value))); prediction = null; }
  if (action === 'resume') { await startSearch(); return; }
  if (p && action === 'cancel-search') await update({ ...p, tasks: p.tasks.map((t, i) => i === p.tasks.length - 1 ? { ...t, status: 'cancelled' } : t) });
  if (p && action === 'target' && prediction) {
    const row = prediction.rows.find((r) => r.counter === Number(value))!;
    if (!p.targets.some((t) => t.counter === row.counter && t.name === prediction!.name && t.weapon === prediction!.weapon && t.attribute === prediction!.attribute)) {
      if (p.targets.length >= 200) throw new Error('最多收藏 200 个目标');
      await update({ ...p, targets: [...p.targets, { id: crypto.randomUUID(), name: prediction.name, weapon: prediction.weapon, attribute: prediction.attribute, ...row }] });
    }
  }
  if (action === 'page' && prediction) prediction.page += Number(value);
  if (p && action === 'logs-page') {
    logPages.set(p.id, Math.max(0, Math.min(Number(value), Math.max(0, Math.ceil(p.logs.length / 10) - 1))));
    render();
    document.querySelector('#execution-logs')?.scrollIntoView({ block: 'start' });
    return;
  }
  if (p && action === 'remove-target') await update({ ...p, targets: p.targets.filter((t) => t.id !== value) });
  if (p && action === 'count') { await update(advance(p, 1, 'padding')); prediction = null; }
  if (p && action === 'undo-count') { await update(undoCount(p)); prediction = null; }
  if (p && action === 'remove-demand') await update({ ...p, demands: p.demands.filter((d) => d.id !== value), targets: p.targets.filter((t) => t.demandId !== value) });
  if (p && action === 'apply-route') {
    if (!p.state) throw new Error('请先确认种子与抽取位置');
    const route = shortestRoute(p.state, p.demands.filter((d) => !d.achieved && d.bonusEnabled));
    if (!route.complete || !route.steps.length) throw new Error('没有可执行的完整路线');
    await update(profileSchema.parse({ ...p, targets: route.steps.map((step) => ({ id: crypto.randomUUID(), demandId: step.demand.id, name: step.demand.name, weapon: step.demand.weapon, attribute: step.demand.attribute, counter: step.counter, roll: step.roll })) }));
  }
  render();
}

async function perform(work: () => Promise<void>) {
  if (busy || searching) return;
  busy = true;
  // FormData must be read before disabling form controls.
  await work().catch(fail).finally(() => { busy = false; lock(); });
}

app.addEventListener('submit', (event) => {
  event.preventDefault();
  if (!(event.target instanceof HTMLFormElement)) return;
  const form = event.target;
  const intent = event.submitter instanceof HTMLButtonElement ? event.submitter.value : undefined;
  void perform(() => handleForm(form, intent));
});
app.addEventListener('click', (event) => {
  if (!(event.target instanceof Element)) return;
  const target = event.target.closest<HTMLElement>('[data-action]');
  if (!target) return;
  event.preventDefault();
  if (target.dataset.action === 'pause') { stop = true; return; }
  void perform(() => handleAction(target.dataset.action!, target.dataset.value ?? ''));
});
app.addEventListener('change', (event) => {
  if (event.target instanceof HTMLSelectElement && (event.target.form?.dataset.form === 'sampling-weapon' || event.target.form?.dataset.form === 'skill-sampling-change' || event.target.form?.dataset.form === 'artian-weapon')) {
    event.target.form.requestSubmit();
    return;
  }
  if (event.target instanceof HTMLInputElement && event.target.form?.dataset.form === 'plan-demand' && event.target.name === 'planRange') {
    const input = event.target;
    if (!input.reportValidity()) return;
    void perform(async () => {
      const p = current();
      if (!p) return;
      await update(profileSchema.parse({ ...p, planRange: Number(input.value) }));
      // Replace only the paths so the unsaved weapon fields and disclosure state survive.
      const template = document.createElement('template');
      template.innerHTML = demandPlanView(current()!);
      document.querySelector('#plan-routes')?.replaceWith(template.content.querySelector('#plan-routes')!);
    });
    return;
  }
  if (event.target instanceof HTMLInputElement && event.target.form?.dataset.form === 'plan-demand' && (event.target.name === 'bonusEnabled' || event.target.name === 'skillsEnabled')) {
    const fields = event.target.form.querySelector<HTMLFieldSetElement>(`[data-demand-fields="${event.target.name === 'bonusEnabled' ? 'bonus' : 'skills'}"]`)!;
    fields.hidden = !event.target.checked;
    fields.disabled = !event.target.checked;
    return;
  }
  if ((event.target instanceof HTMLSelectElement || event.target instanceof HTMLInputElement) && event.target.form?.dataset.form === 'skill-table-filter' && event.target.name !== 'count') {
    event.target.form.requestSubmit();
    return;
  }
  if (event.target instanceof HTMLSelectElement && event.target.form?.dataset.form === 'predict' && (event.target.name === 'weapon' || event.target.name === 'attribute')) {
    const draft = predictionDrafts.get(archive.active ?? '');
    if (!draft) return;
    draft[event.target.name] = Number(event.target.value);
    return;
  }
  if (!(event.target instanceof HTMLSelectElement) || event.target.id !== 'profile-select') return;
  const id = event.target.value;
  void perform(async () => { await commit({ ...archive, active: id }); entry = ''; prediction = null; editSample = null; editSkillSample = null; render(); });
});
app.addEventListener('focusin', (event) => {
  if (event.target instanceof HTMLTextAreaElement || (event.target instanceof HTMLInputElement && event.target.type !== 'checkbox')) {
    document.querySelector('.shell')?.classList.add('editing');
  }
});
app.addEventListener('focusout', () => {
  requestAnimationFrame(() => {
    const active = document.activeElement;
    if (!(active instanceof HTMLTextAreaElement) && !(active instanceof HTMLInputElement && active.type !== 'checkbox')) {
      document.querySelector('.shell')?.classList.remove('editing');
    }
  });
});
document.addEventListener('visibilitychange', () => { if (document.hidden) stop = true; });

app.innerHTML = '<div class="shell"><h1>巨戟观星</h1><p>正在读取本地档案…</p><div id="message" role="alert" hidden></div></div>';
openStorage(() => { stop = true; }).then(async (value) => {
  storage = value;
  archive = await storage.read() ?? emptyArchive();
  render();
}).catch((error: unknown) => {
  fail(error);
  document.querySelector('#message')!.insertAdjacentHTML('afterend', '<p>读取失败，未覆盖已有记录。请检查宿主存储权限或备份格式后重新打开。</p>');
});
