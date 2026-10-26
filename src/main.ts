import './styles.css';
import { z } from 'zod';
import { ALGORITHM, attributes, bonuses, compile, compileRequirements, pool, predict, weapons } from './engine';
import { advance, align, archiveSchema, canUndoCount, deleteProfile, emptyArchive, encodeCode, makeTask, newProfile, parseCode, profileSchema, restoreCheckpoint, saveCheckpoint, setCounter, uint, undoCount, useCandidate, verifySample } from './model';
import type { Archive, Position, Profile, Task } from './model';
import { runSearch, searchProgress } from './search';
import { openStorage, standalone } from './storage';
import { mountSelectors } from './selector';
import { shortestRoute } from './planner';

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
let preview: Position | null = null;
let exportText = '';
let renderedView = '';
let messageTimer: ReturnType<typeof setTimeout> | undefined;
const predictionDrafts = new Map<string, { weapon: number; attribute: number; name: string; edited: boolean }>();
const logPages = new Map<string, number>();
let prediction: { weapon: number; attribute: number; name: string; rows: { counter: number; roll: number[] }[]; limit: number; page: number; requirements: number[] } | null = null;

const escape = (value: unknown) => String(value).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const button = (label: string, action: string, value = '', style = '') => `<button type="button" class="${style}${action === 'target' && label === '已加入' ? ' is-saved' : ''}" data-action="${action}" data-value="${escape(value)}"${action === 'tab' && value === tab ? ' aria-current="page"' : ''}>${label}</button>`;
const field = (label: string, name: string, value = '', type = 'text', extra = '') => `<label>${label}<input name="${name}" type="${type}" value="${escape(value)}" ${extra}></label>`;
const number = (label: string, name: string, value = '', max = 0xffffffff) => field(label, name, value, 'number', `min="0" max="${max}" step="1" required`);
const select = (label: string, name: string, list: string[], selected: number) => `<label>${label}<select name="${name}">${list.map((text, i) => `<option value="${i}" ${i === selected ? 'selected' : ''}>${text}</option>`).join('')}</select></label>`;
const check = (name: string, text: string) => `<label class="check"><input type="checkbox" name="${name}" required>${text}</label>`;
const submit = (text: string) => `<button class="primary" type="submit">${text}</button>`;
const current = () => archive.profiles.find((p) => p.id === archive.active);
const chips = (roll: number[]) => `<div class="chips">${roll.map((id) => `<span class="bonus b${bonuses.find((b) => b.id === id)?.category}">${bonuses.find((b) => b.id === id)?.name}</span>`).join('')}</div>`;

function message(text: string, error = false) {
  clearTimeout(messageTimer);
  const node = document.querySelector<HTMLElement>('#message')!;
  node.textContent = text;
  node.className = error ? 'message error' : 'message';
  node.hidden = !text;
  if (text && !error) messageTimer = setTimeout(() => { node.hidden = true; }, 2200);
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
  if (entry === 'about') return `<section class="card"><div class="section-heading"><h2>关于</h2>${button('返回', 'about-back', '', 'small')}</div>${standalone ? '<p class="preview-label"><i aria-hidden="true"></i>开发预览</p>' : ''}<p>怪物猎人：荒野 · 巨戟武器完全重抽辅助</p><p>算法参考 GogmaSeedFinder / WiseHorror GARP<br>${ALGORITHM}</p><p>本版尚待小黑盒真机验收。技能与 Keep 预测后续提供。</p></section>`;
  if (entry === 'import') return `<section class="card"><div class="section-heading"><h2>导入档案</h2>${button('返回', 'home', '', 'small')}</div>
    <form data-form="preview"><label>续接码<textarea name="code" placeholder="GSF2-B…-G…-S…" required></textarea></label>${submit('解析并预览')}</form>
    ${preview ? `<div class="notice">种子 <b>${preview.seed}</b> · 下一次复原位置 <b>${preview.counter}</b> · 技能位置 ${preview.skill ?? '未知'}</div>
    <form data-form="import">${field('档案名称', 'name', '我的观星档案', 'text', 'required maxlength="80"')}${submit('建立档案')}</form>` : ''}
    <details><summary>手动输入种子与位置</summary><form data-form="manual"><div class="grid">${number('种子', 'seed')}${field('下一次复原位置（不知道可留空）', 'counter', '', 'number', 'min="0" max="4294967295" step="1"')}${field('技能位置（可留空）', 'skill', '', 'number', 'min="0" max="4294967295" step="1"')}</div>${submit('建立待核对档案')}</form></details>
    <details><summary>恢复完整备份</summary><form data-form="backup"><label>JSON 备份<textarea name="json" required></textarea></label>${submit('导入为新档案')}</form></details></section>`;
  return `<section class="card"><div class="section-heading"><h2>新建档案</h2>${current() ? button('返回', 'home', '', 'small') : ''}</div><p>先手动保存游戏，再连续完全重抽，按从左到右的顺序记录五槽。</p><form data-form="new"><div class="grid">${field('档案名称', 'name', '我的第一次观星', 'text', 'required maxlength="80"')}${field('平台', 'platform', '', 'text', 'placeholder="例如 PC / PS5" maxlength="40"')}${field('游戏版本', 'gameVersion', '', 'text', 'placeholder="不知道可留空" maxlength="40"')}</div>${check('saved', '我已在采样前保存游戏，能够回到这个基线')}${submit('开始记录')}</form></section>`;
}

function gateView(p: Profile) {
  if (p.gate) return '';
  return `<section class="card gate-card"><h3>完全重抽</h3><details><summary>适用条件</summary><p>仅支持复原 counter gate 已启用（≥ 0x23）的 Reset。这不等于已抽 35 次；工具尚不能自动检测门控状态。若不确定，请从同一基线重抽、回档重放，再用额外样本核对。</p></details><form data-form="gate">${check('gate', '按已启用抽取位置的假设使用完全重抽，并用额外样本核对')}${submit('确认')}</form></section>`;
}

function observe(p: Profile) {
  const latest = p.tasks.at(-1);
  return `<div class="section-heading"><h2>${p.state ? '观星' : '采样'}</h2></div>${gateView(p)}
    ${!p.rolls.length && !p.aligned ? `<section class="card"><h3>采样武器</h3><form data-form="sampling-weapon"><div class="grid">${select('武器种类', 'weapon', weapons, p.sampling.weapon)}${select('属性 / 异常', 'attribute', attributes, p.sampling.attribute)}</div>${submit('设置采样武器')}</form></section>` : ''}
    ${p.state ? `<section class="card state-card"><h3>种子 ${p.state.seed}</h3><p>下一次复原位置 <b>${p.state.counter}</b> · 技能位置 ${p.state.skill ?? '未知'}</p><p>${p.calibrated ? '✓ 已校准' : '待额外样本校准'} · ${p.aligned ? '位置已确认' : '位置待确认'}</p>${button('查看预测', 'tab', 'predict', 'primary')}
      ${!p.aligned ? `<form data-form="align"><label>现在的游戏位置<select name="mode"><option value="baseline">我已回到采样前基线 / 导入码对应的位置</option><option value="sampled">我没有回档，仍在全部已录样本之后</option><option value="current">已核对与当前工具位置 ${p.state.counter} 一致</option></select></label>${check('aligned', '我已核对游戏实际位置；工具不会代我回档')}${submit('确认位置，进入执行准备')}</form>` : ''}</section>` : ''}
    ${!p.aligned ? `<section class="card sample-card${p.rolls.length ? '' : ' solo'}"><h3>${editSample === null ? `录入第 ${p.rolls.length + 1} 抽` : `修改第 ${editSample + 1} 抽`}</h3><p>${weapons[p.sampling.weapon]} · ${attributes[p.sampling.attribute]} · 连续记录，至少两抽，建议六抽。</p><form data-form="sample">${slots(p, editSample === null ? undefined : p.rolls[editSample])}<div class="actions">${submit(editSample === null ? '保存这一抽' : '保存修改')}${editSample !== null ? button('取消修改', 'edit-cancel') : ''}</div></form>
      ${p.baseline && !p.calibrated ? `<details><summary>用新抽取的额外一抽验证候选</summary><p>以下一抽须紧接已录的 ${p.rolls.length} 抽之后，不能重复填写旧结果。验证成功会追加这条样本。</p><form data-form="verify">${slots(p)}${submit('核对额外一抽')}</form></details>` : ''}</section>` : '<p class="notice">已进入正式位置。新一轮采样请建立新档案，避免混入当前执行记录。</p>'}
    ${p.rolls.length ? `<section class="card records-card${p.aligned ? ' solo' : ''}"><h3>观测记录 <span class="count">${p.rolls.length}</span></h3><div class="records-list">${p.rolls.map((r, i) => `<article class="sample"><b>${String(i + 1).padStart(2, '0')}</b>${chips(r)}${!p.aligned ? button('修改', 'edit', String(i), 'small') : ''}</article>`).join('')}</div>${!p.aligned ? button('删除最后一抽', 'delete-sample', '', 'small text-button') : ''}</section>` : ''}
    ${!p.aligned ? `<section class="card"><h3>搜索种子与位置</h3><form data-form="search"><div class="grid">${number('种子下界', 'seedStart', String(p.seedHint ?? 0))}${number('种子上界', 'seedEnd', String(p.seedHint ?? 99999999))}${number('起始位置下界', 'counterStart')}${number('起始位置上界', 'counterEnd')}</div>${submit('开始搜索')}</form><details><summary>位置怎么填？</summary><p>填写采样第一抽的绝对 counter。已知位置时上下界相同；不知道时需明确本次探索范围。相对第 0 抽不等于 counter=0。</p><p>范围越宽，等待越久。搜索可暂停续接，已搜索范围会保留。</p></details></section>` : ''}
    ${latest ? searchView(latest, p) : ''}
    ${p.tasks.length > 1 ? `<details class="card search-history"><summary>历史搜索范围（${p.tasks.length - 1} 个）</summary>${p.tasks.slice(0, -1).map((t) => `<p>种子 ${t.seedStart}–${t.seedEnd} / 位置 ${t.counterStart}–${t.counterEnd}：${t.status === 'complete' ? '范围完成' : '未完成'}，${searchProgress(t).percent.toFixed(1)}%，${t.candidates.length} 个候选</p>`).join('')}</details>` : ''}`;
}

function searchView(t: Task, p: Profile) {
  const matching = JSON.stringify(t.rolls) === JSON.stringify(p.rolls);
  return `<section class="card" id="search-card"><h3>${searching ? '正在搜索 · 保持页面在前台' : '最近搜索任务'}</h3><p>种子 ${t.seedStart}–${t.seedEnd} · 位置 ${t.counterStart}–${t.counterEnd}</p><div id="search-progress"></div>
    <div class="actions">${searching ? button('暂停并保存进度', 'pause', '', 'primary') : t.status === 'paused' && matching ? button('继续搜索', 'resume', '', 'primary') : ''}${!searching && t.status === 'paused' ? button('取消此任务', 'cancel-search') : ''}</div>
    ${!matching ? '<p class="notice">观测已更新，此任务保留为历史结果。请用当前样本建立新搜索。</p>' : ''}
    ${t.status === 'overflow' ? '<p class="notice">候选过多，已停止。请补充连续样本或缩小范围后重新搜索。</p>' : ''}
    ${t.status === 'complete' && !t.candidates.length ? '<p class="notice">本范围内零候选。检查槽位、武器属性、连续性、门控假设与范围，再修正或扩展。</p>' : ''}
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
  return `<div class="section-heading"><h2>管理存档</h2><div class="actions">${button('导出', 'export', '', 'small')}${button('返回', 'home', '', 'small')}</div></div>${archive.profiles.length ? archive.profiles.map((p) => `<section class="card archive-card"><div class="section-heading"><h3>${escape(p.name)}</h3>${archive.active === p.id ? '<span class="badge">当前存档</span>' : ''}</div>${p.state ? `<p>种子 ${p.state.seed}</p>` : ''}<form data-form="profile-edit" data-profile="${escape(p.id)}">${field('档案名称', 'name', p.name, 'text', 'required maxlength="80"')}${p.state ? number('当前计数（下一次复原位置）', 'counter', String(p.state.counter)) : '<p class="muted">尚未确定种子与位置，暂不能修改计数。</p>'}${submit('保存修改')}</form><div class="actions archive-actions">${deletingProfile === p.id ? `<span>删除此存档？</span>${button('确认删除', 'delete-profile', p.id, 'small primary')}${button('取消', 'cancel-delete-profile', '', 'small')}` : button('删除存档', 'confirm-delete-profile', p.id, 'small')}</div></section>`).join('') : '<section class="card empty"><p>暂无存档</p></section>'}`;
}

function predictView(p: Profile) {
  if (!p.state || !p.gate) return `<section class="card empty"><h2>尚未确认抽取位置</h2>${button('前往观星', 'tab', 'observe', 'primary')}</section>`;
  const draft = predictionDrafts.get(p.id) ?? { weapon: 0, attribute: 0, name: predictionName(0, 0), edited: false };
  predictionDrafts.set(p.id, draft);
  const rows = prediction?.rows.slice(prediction.page * 30, (prediction.page + 1) * 30) ?? [];
  return `<div class="section-heading"><h2>未来加成</h2></div>
    ${!p.aligned || !p.calibrated ? '<p class="notice">预测预览：尚未完成额外样本核对或游戏位置确认。请在执行前到观星页核对。</p>' : ''}
    <details class="card filters-card" ${prediction ? '' : 'open'}><summary>筛选</summary><form data-form="predict"><div class="grid">${field('武器名称', 'name', draft.name, 'text', 'required maxlength="80"')}${select('武器种类', 'weapon', weapons, draft.weapon)}${select('属性 / 异常', 'attribute', attributes, draft.attribute)}</div><fieldset class="requirements"><legend>加成需求 <span class="muted">选填 · 不限顺序</span></legend><div class="slots">${Array.from({ length: 5 }, (_, i) => `<label><span class="slot-number" aria-hidden="true">0${i + 1}</span><select name="requirement${i}" aria-label="加成需求 ${i + 1}"><option value="0">不限</option>${bonuses.map((b) => `<option value="${b.id}" ${prediction?.requirements[i] === b.id ? 'selected' : ''}>${b.name}</option>`).join('')}</select></label>`).join('')}</div></fieldset>${number('向后预测次数', 'count', String(prediction?.limit ?? 1000), 10000)}<div class="actions">${submit('生成预测')}<button type="submit" name="intent" value="save-demand">保存需求</button></div></form></details>
    ${prediction ? `<section class="card"><h3>${escape(prediction.name)} <span class="muted">${prediction.rows.length} 条匹配 / ${prediction.limit} 抽</span></h3>${rows.length ? rows.map((r) => `<article class="future-row"><div><h3>再抽 ${r.counter - p.state!.counter + 1} 次</h3><small>位置 ${r.counter}</small></div>${chips(r.roll)}${button(p.targets.some((t) => t.counter === r.counter && t.name === prediction!.name && t.weapon === prediction!.weapon && t.attribute === prediction!.attribute) ? '已加入' : '+ 加入计划', 'target', String(r.counter), 'small')}</article>`).join('') : '<p class="empty">没有匹配结果，试试调整条件或范围。</p>'}<div class="actions">${prediction.page > 0 ? button('上一页', 'page', '-1') : ''}${(prediction.page + 1) * 30 < prediction.rows.length ? button('下一页', 'page', '1') : ''}</div></section>` : ''}`;
}

function predictionName(weapon: number, attribute: number) {
  return `${attributes[attribute]}${attribute === 0 ? '' : attribute <= 5 ? '属性' : '异常'}${weapons[weapon]}`;
}

function demandPlanView(p: Profile) {
  const pending = p.demands.filter((d) => !d.achieved);
  const route = p.state && p.gate && pending.length ? shortestRoute(p.state, pending) : null;
  return `<section class="card"><h3>已保存需求 <span class="count">${p.demands.length}</span></h3>${p.demands.length ? p.demands.map((d) => `<article class="future-row"><div><b>${escape(d.name)}</b><p>${weapons[d.weapon]} · ${attributes[d.attribute]} · ${d.achieved ? '已获得' : '待获得'}</p></div>${d.requirements.some(Boolean) ? chips(d.requirements.filter(Boolean)) : '<p class="chips muted">加成不限</p>'}${button('删除', 'remove-demand', d.id, 'small')}</article>`).join('') : '<p>在预测筛选中设置加成并保存需求，每条需求对应一把武器。</p>'}</section>
    ${p.demands.length ? `<section class="card"><h3>最短强化路径</h3>${!pending.length ? '<p>全部需求已获得。</p>' : !route ? '<p>先在观星页确认种子与抽取位置。</p>' : !route.complete ? `<p class="notice">向后搜索 ${route.searched} 次，未找到满足全部需求的路线。可放宽需求后重试。</p>` : `<p>从位置 ${p.state!.counter} 起，共 ${route.total} 次完全重抽，其中 ${route.total - pending.length} 次垫刀。每条需求获得一把武器。</p>${!p.aligned || !p.calibrated ? '<p class="notice">路线预览：执行前请核对样本与游戏位置。</p>' : ''}<ol class="route-list">${route.steps.map((step) => `<li>${step.padding ? `<p>先垫刀 <b>${step.padding}</b> 次</p>` : ''}<b>${escape(step.demand.name)}</b><p>${weapons[step.demand.weapon]} · ${attributes[step.demand.attribute]} · 位置 ${step.counter}<br>完全重抽 1 次，核对并保留</p>${chips(step.roll)}</li>`).join('')}</ol><p class="muted">按总强化次数最少计算，最多搜索 10,000 次；同一位置仅用于一把武器。垫刀使用其他武器，已获得的武器不再重抽。</p>${button('用此路线替换执行目标', 'apply-route', '', 'primary')}`}</section>` : ''}`;
}

function planView(p: Profile) {
  const pages = Math.max(1, Math.ceil(p.logs.length / 10));
  const page = Math.min(logPages.get(p.id) ?? 0, pages - 1);
  const logs = p.logs.slice(Math.max(0, p.logs.length - (page + 1) * 10), p.logs.length - page * 10).reverse();
  const upcoming = p.targets.filter((t) => t.counter >= (p.state?.counter ?? 0)).sort((a, b) => a.counter - b.counter);
  const first = upcoming[0];
  const conflict = first && upcoming.filter((t) => t.counter === first.counter).length > 1;
  const distance = first && p.state ? first.counter - p.state.counter : null;
  return `<div class="section-heading"><h2>执行计划</h2><span class="badge">${p.aligned ? '位置已确认' : '待核对位置'}</span></div>
    ${demandPlanView(p)}
    <section class="card execution-card"><h3>下一次复原位置 <span class="position">${p.state?.counter ?? '未知'}</span></h3><p>游戏保存点：${p.checkpoint ? `${p.checkpoint.position.counter} · ${escape(p.checkpoint.at)}` : '尚未确认'}</p>
    ${!p.aligned ? button('先核对游戏位置', 'tab', 'observe', 'primary') : first ? `<div class="metric"><b>${distance}</b><span>次垫刀后到达 ${escape(first.name)}<br>含目标还需 ${distance! + 1} 次</span></div>${conflict ? '<p class="notice">同格目标冲突：请在下方移除其中一个，或重新选择后备位置。</p>' : distance ? '' : `<h3>下一抽就是目标</h3><p>${weapons[first.weapon]} · ${attributes[first.attribute]} · 完全重抽</p>${chips(first.roll)}<form data-form="target-result"><label>实际操作结果<select name="result"><option value="accepted">结果一致，已采用</option><option value="rejected">结果一致，但未采用</option><option value="mismatch">结果与预测不符</option></select></label>${check('done', '我已完成这次游戏抽取并核对结果')}${submit('记录目标操作')}</form>`}` : '<p class="empty">还没有待兑现目标。到预测页收藏一条结果吧。</p>'}
    ${p.aligned ? `<div class="actions counter-actions"><button type="button" class="primary" data-action="count" ${first && !distance ? 'data-unavailable disabled' : ''}>计数 +1</button><button type="button" data-action="undo-count" ${canUndoCount(p) ? '' : 'data-unavailable disabled'}>撤回一次计数</button></div>` : ''}
    ${p.aligned ? `<form data-form="checkpoint">${check('saved', '我已在游戏里手动保存当前成果')}${submit('记录游戏保存检查点')}</form>` : ''}
    ${p.checkpoint ? `<details><summary>已在游戏回档？</summary><form data-form="restore">${check('restored', '我已在游戏中回到上面显示的保存检查点')}${submit('同步工具到该检查点')}</form></details>` : ''}</section>
    <section class="card"><h3>目标清单</h3>${p.targets.length ? [...p.targets].sort((a, b) => a.counter - b.counter).map((t) => `<article class="future-row"><div><b>${escape(t.name)}</b><p>${weapons[t.weapon]} · ${attributes[t.attribute]}<br>位置 ${t.counter} · ${t.counter < (p.state?.counter ?? 0) ? '已越过 / 查看执行记录' : p.targets.filter((v) => v.counter === t.counter).length > 1 ? '同格冲突' : '待兑现'}</p></div>${chips(t.roll)}${button('移除', 'remove-target', t.id, 'small')}</article>`).join('') : '<p class="empty">收藏目标后会自动按位置排序。</p>'}</section>
    <section class="card" id="execution-logs"><h3>执行记录 <span class="count">${p.logs.length}</span></h3><div class="log-list">${logs.length ? logs.map((l) => `<p><b>${escape(l.text)}</b><br><small>${l.before} → ${l.after} · ${escape(l.at)}</small></p>`).join('') : '<p class="empty">完成游戏操作后，再在这里确认计数。</p>'}</div>${p.logs.length ? `<div class="log-pagination" role="group" aria-label="执行记录分页"><button type="button" class="small" data-action="logs-page" data-value="${page - 1}" ${page === 0 ? 'data-unavailable disabled' : ''}>上一页</button><span class="muted" aria-live="polite">${page + 1} / ${pages}</span><button type="button" class="small" data-action="logs-page" data-value="${page + 1}" ${page === pages - 1 ? 'data-unavailable disabled' : ''}>下一页</button></div>` : ''}</section>`;
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
      ['plan', '计划', '<path d="M9 5h11M9 12h11M9 19h11M2 5l1 1 2-2M2 12l1 1 2-2M2 19l1 1 2-2"/>'],
    ].map(([id, label, paths]) => button(`<svg viewBox="0 0 24 24" aria-hidden="true">${paths}</svg><span>${label}</span>`, 'tab', id, tab === id ? 'active' : '')).join('')}</nav>` : ''}
    <div class="view view-${view}${key !== renderedView ? ' enter' : ''}${view === 'predict' && prediction ? ' has-results' : ''}">${entry || !p ? entryView() : tab === 'observe' ? observe(p) : tab === 'predict' ? predictView(p) : planView(p)}</div>
    ${exportText ? `<section class="card"><h3>导出与备份</h3><p>选择文本并复制保存。续接码只包含种子和位置，完整备份还包含样本、目标和任务。</p>${p?.state ? `<p>当前工具位置：<code>${encodeCode(p.state)}</code> ${p.aligned ? '' : '（待核对）'}</p>` : ''}${p?.checkpoint ? `<p>已确认游戏保存点：<code>${encodeCode(p.checkpoint.position)}</code></p>` : '<p>暂无已确认游戏保存点，请不要将当前工具位置当作已保存的游戏状态。</p>'}<label>完整备份<textarea readonly rows="6">${escape(exportText)}</textarea></label>${button('收起', 'export-close')}</section>` : ''}</div>
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
  if (task.status !== 'paused' || JSON.stringify(task.rolls) !== JSON.stringify(p.rolls)) throw new Error('此任务不能续搜，请建立新任务');
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
  entry = ''; tab = 'observe'; prediction = null; preview = null; editSample = null;
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
    await update(profileSchema.parse({ ...(profile.state ? setCounter(profile, num('counter')) : profile), name: text('name') }));
    prediction = null;
    exportText = '';
    render();
    message('档案已更新');
    return;
  }
  if (type === 'preview') { preview = parseCode(text('code')); render(); return; }
  if (type === 'new' || type === 'import') {
    const next = newProfile(text('name'));
    await addProfile(type === 'import' ? { ...next, state: preview, baseline: preview, seedHint: preview?.seed ?? null, skillHint: preview?.skill ?? null } : { ...next, platform: text('platform') || '未填写', gameVersion: text('gameVersion') || '未知' });
    render(); return;
  }
  if (type === 'manual') {
    const seed = num('seed');
    const state = text('counter') ? { seed, counter: num('counter'), skill: text('skill') ? num('skill') : null } : null;
    if (!state && text('skill')) throw new Error('仅有种子时请暂不填写技能位置，取得复原位置后可用 GSF2 导入');
    await addProfile({ ...newProfile('手动导入档案'), state, baseline: state, seedHint: seed, skillHint: state?.skill ?? null });
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
  if (type === 'sampling-weapon') await update(profileSchema.parse({ ...p, sampling: { weapon: num('weapon'), attribute: num('attribute') }, calibrated: false }));
  if (type === 'gate') await update({ ...p, gate: true });
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
    if (!p.gate) throw new Error('请先确认算法适用假设');
    await update(text('mode') === 'current' ? { ...p, aligned: true } : align(p, text('mode') === 'sampled'));
  }
  if (type === 'search') {
    if (p.tasks.length >= 20) throw new Error('每档案最多 20 个搜索任务，请导出并建立新档案');
    const task = makeTask(p, { seedStart: num('seedStart'), seedEnd: num('seedEnd'), counterStart: num('counterStart'), counterEnd: num('counterEnd') });
    await update({ ...p, tasks: [...p.tasks, task] });
    await startSearch(); return;
  }
  if (type === 'predict') {
    if (!p.state || !p.gate) throw new Error('先取得种子、位置并确认适用假设');
    const count = num('count');
    if (count < 1 || count > 10000 || p.state.counter + count > 0xffffffff) throw new Error('预测范围为 1–10,000 抽，且不可超出位置上限');
    const weapon = num('weapon'); const attribute = num('attribute');
    const requirements = Array.from({ length: 5 }, (_, i) => num(`requirement${i}`));
    const matches = compileRequirements(requirements);
    if (intent === 'save-demand') {
      if (p.demands.length >= 20) throw new Error('每个档案最多保存 20 条需求');
      await update(profileSchema.parse({ ...p, demands: [...p.demands, { id: crypto.randomUUID(), name: text('name'), weapon, attribute, requirements }] }));
      message('需求已保存，可在计划中查看最短路径');
      return;
    }
    const rows = predict(p.state.seed, weapon, attribute, p.state.counter, count)
      .map((roll, i) => ({ counter: p.state!.counter + i, roll }))
      .filter((r) => matches(r.roll));
    prediction = { weapon, attribute, name: text('name'), rows, limit: count, page: 0, requirements };
  }
  if (type === 'target-result') {
    await update(advance(p, 1, z.enum(['accepted', 'rejected', 'mismatch']).parse(text('result')))); prediction = null;
  }
  if (type === 'checkpoint') await update(saveCheckpoint(p));
  if (type === 'restore') { await update(restoreCheckpoint(p)); prediction = null; }
  render(); message(type === 'predict' ? '' : '工具记录已保存');
}

async function handleAction(action: string, value: string) {
  const p = current();
  if (action === 'pause') { stop = true; return; }
  if (action === 'home') { entry = ''; tab = 'observe'; }
  if (action === 'about' && entry !== 'about') { aboutReturn = entry; entry = 'about'; exportText = ''; }
  if (action === 'about-back') entry = aboutReturn;
  if (action === 'entry') { entry = value; preview = null; exportText = ''; }
  if (action === 'tab') { tab = value; entry = ''; }
  if (action === 'export') exportText = JSON.stringify(archive, null, 2);
  if (action === 'confirm-delete-profile') deletingProfile = value;
  if (action === 'cancel-delete-profile') deletingProfile = '';
  if (action === 'delete-profile') {
    await commit(deleteProfile(archive, value));
    predictionDrafts.delete(value);
    logPages.delete(value);
    deletingProfile = ''; prediction = null; preview = null; editSample = null; exportText = '';
    if (!archive.profiles.length) entry = 'new';
  }
  if (action === 'export-close') exportText = '';
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
    if (!p.state || !p.gate) throw new Error('请先确认种子与抽取位置');
    const route = shortestRoute(p.state, p.demands.filter((d) => !d.achieved));
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
app.addEventListener('input', (event) => {
  if (!(event.target instanceof HTMLInputElement) || event.target.name !== 'name' || event.target.form?.dataset.form !== 'predict') return;
  const draft = predictionDrafts.get(archive.active ?? '');
  if (!draft) return;
  draft.name = event.target.value;
  draft.edited = true;
});
app.addEventListener('change', (event) => {
  if (event.target instanceof HTMLSelectElement && event.target.form?.dataset.form === 'predict' && (event.target.name === 'weapon' || event.target.name === 'attribute')) {
    const draft = predictionDrafts.get(archive.active ?? '');
    if (!draft) return;
    draft[event.target.name] = Number(event.target.value);
    if (!draft.edited) {
      draft.name = predictionName(draft.weapon, draft.attribute);
      event.target.form.querySelector<HTMLInputElement>('input[name="name"]')!.value = draft.name;
    }
    return;
  }
  if (!(event.target instanceof HTMLSelectElement) || event.target.id !== 'profile-select') return;
  const id = event.target.value;
  void perform(async () => { await commit({ ...archive, active: id }); entry = ''; prediction = null; editSample = null; exportText = ''; render(); });
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
