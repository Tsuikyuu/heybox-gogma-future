// Adapted from GogmaSeedFinder 65789e9 (MIT), via the validated JS experiment.
// See ../THIRD_PARTY_NOTICES.md. Predictions require their respective active counter gates.
export const ALGORITHM = 'gsf-65789e9-reset-v1';
export const weapons = ['大剑', '片手剑', '双剑', '太刀', '大锤', '狩猎笛', '长枪', '铳枪', '斩斧', '盾斧', '操虫棍', '弓', '重弩', '轻弩'];
export const attributes = ['无属性', '火', '水', '冰', '雷', '龙', '毒', '麻痹', '睡眠', '爆破'];
export const bonuses = [
  { id: 8, name: '攻击 II', category: 0, tier: 2 }, { id: 12, name: '攻击 III', category: 0, tier: 3 },
  { id: 15, name: '攻击 EX', category: 0, tier: 4 }, { id: 9, name: '会心 II', category: 1, tier: 2 },
  { id: 13, name: '会心 III', category: 1, tier: 3 }, { id: 16, name: '会心 EX', category: 1, tier: 4 },
  { id: 11, name: '属性 II', category: 2, tier: 2 }, { id: 14, name: '属性 EX', category: 2, tier: 4 },
  { id: 6, name: '斩味／装填', category: 3, tier: 2 }, { id: 10, name: '斩味／装填 EX', category: 3, tier: 4 },
];
const categories: Record<number, number> = Object.fromEntries(bonuses.map((b) => [b.id, b.category]));

export function compileRequirements(requirements: number[]) {
  const required = requirements.filter((id) => id !== 0).map((id) => {
    const bonus = bonuses.find((bonus) => bonus.id === id);
    if (!bonus) throw new Error('请选择有效的加成需求');
    return bonus;
  }).sort((a, b) => b.tier - a.tier);
  return (roll: number[]) => {
    const available = roll.map((id) => bonuses.find((bonus) => bonus.id === id)!);
    // Match higher requirements first and consume each slot only once.
    return required.every((requirement) => {
      const index = available.findIndex((bonus) => bonus.category === requirement.category && bonus.tier >= requirement.tier);
      if (index < 0) return false;
      available.splice(index, 1);
      return true;
    });
  };
}

export function initialize(seed: number, state = new Uint32Array(4)) {
  let x = 0x159a55e5;
  let y = 0x1f123bb5;
  let z = 0x05491333;
  let w = z;
  for (let i = 1; i <= 100; i++) {
    const mixed = (0x65ac9365 >>> (seed & 3)) ^ seed;
    seed = (mixed << 4) ^ (mixed << 3) ^ (mixed >>> 3) ^ (mixed >>> 4) ^ mixed;
    const t = seed ^ (seed << 15);
    w = z ^ (z >>> 21) ^ t ^ (t >>> 4);
    if (i < 100) { x = y; y = z; z = w; }
  }
  state.set([x, y, z, w]);
  return state;
}

function step(state: Uint32Array) {
  const t = state[0]! ^ (state[0]! << 15);
  const w = state[3]! ^ (state[3]! >>> 21) ^ t ^ (t >>> 4);
  state[0] = state[1]!;
  state[1] = state[2]!;
  state[2] = state[3]!;
  state[3] = w;
  return w >>> 0;
}

function apply(columns: Uint32Array, state: Uint32Array, out: Uint32Array) {
  out.fill(0);
  for (let word = 0; word < 4; word++) {
    let bits = state[word]!;
    while (bits !== 0) {
      const index = (word * 32 + 31 - Math.clz32(bits & -bits)) * 4;
      for (let k = 0; k < 4; k++) out[k] = out[k]! ^ columns[index + k]!;
      bits &= bits - 1;
    }
  }
}

function compose(after: Uint32Array, before: Uint32Array) {
  const out = new Uint32Array(512);
  for (let i = 0; i < 128; i++) apply(after, before.subarray(i * 4, i * 4 + 4), out.subarray(i * 4, i * 4 + 4));
  return out;
}

function jumpTable(steps: number) {
  let result = new Uint32Array(512);
  for (let i = 0; i < 128; i++) result[i * 4 + Math.floor(i / 32)] = 1 << (i % 32);
  let power = result.slice();
  for (let i = 0; i < 128; i++) step(power.subarray(i * 4, i * 4 + 4));
  while (steps > 0) {
    if (steps % 2) result = compose(power, result);
    steps = Math.floor(steps / 2);
    if (steps > 0) power = compose(power, power);
  }
  const table = new Uint32Array(16 * 256 * 4);
  for (let byte = 0; byte < 16; byte++) {
    for (let value = 1; value < 256; value++) {
      const bit = 31 - Math.clz32(value & -value);
      const previous = (byte * 256 + (value & (value - 1))) * 4;
      const index = (byte * 256 + value) * 4;
      for (let k = 0; k < 4; k++) table[index + k] = table[previous + k]! ^ result[(byte * 8 + bit) * 4 + k]!;
    }
  }
  return table;
}

function jump(table: Uint32Array, state: Uint32Array, out: Uint32Array) {
  out.fill(0);
  for (let byte = 0; byte < 16; byte++) {
    const index = (byte * 256 + ((state[byte >>> 2]! >>> ((byte & 3) * 8)) & 255)) * 4;
    for (let k = 0; k < 4; k++) out[k] = out[k]! ^ table[index + k]!;
  }
}

function weight(id: number, selected: number[]) {
  const category = categories[id];
  if (selected.filter((value) => categories[value] === category).length >= (category === 3 ? 2 : 5)) return 0;
  return Math.max(0, 100 - selected.filter((value) => value === id).length * ([10, 14, 15, 16].includes(id) ? 80 : 50));
}

export function pool(weapon: number, attribute: number) {
  return bonuses.filter((b) => !(weapon === 11 && b.category === 3) && !((weapon >= 12 || attribute === 0) && b.category === 2));
}

export function compile(weapon: number, attribute: number, rolls: number[][]) {
  const candidates = pool(weapon, attribute).map((b) => b.id);
  return new Uint32Array(rolls.flatMap((roll) => {
    if (roll.length !== 5) throw new Error('每抽需要从左到右的完整五槽');
    return roll.flatMap((id, slot) => {
      const weights = candidates.map((value) => weight(value, roll.slice(0, slot)));
      const index = candidates.indexOf(id);
      if (index < 0 || weights[index] === 0) throw new Error(`第 ${slot + 1} 槽不符合武器候选池或重复上限`);
      const start = weights.slice(0, index).reduce((a, b) => a + b, 0);
      return [weights.reduce((a, b) => a + b, 0), start, start + weights[index]!];
    });
  }));
}

function matches(x: number, y: number, z: number, w: number, constraints: Uint32Array) {
  for (let offset = 0; offset < constraints.length; offset += 15) {
    for (let slot = 0; slot < 10; slot++) {
      const t = x ^ (x << 15);
      const next = w ^ (w >>> 21) ^ t ^ (t >>> 4);
      x = y; y = z; z = w; w = next;
      if (slot >= 5) continue;
      const index = offset + slot * 3;
      const value = (w >>> 0) % constraints[index]!;
      if (value < constraints[index + 1]! || value >= constraints[index + 2]!) return false;
    }
  }
  return true;
}

export function createSearch(weapon: number, attribute: number, counterStart: number, counterEnd: number, rolls: number[][]) {
  const constraints = compile(weapon, attribute, rolls);
  const table = jumpTable(counterStart * 10);
  const initial = new Uint32Array(4);
  const state = new Uint32Array(4);
  return (seedStart: number, seedEnd: number) => {
    const found: { seed: number; counter: number }[] = [];
    for (let seed = seedStart; seed <= seedEnd; seed++) {
      initialize(((seed + weapon * 1000 + attribute) >>> 0) ^ 0x00ac9365, initial);
      jump(table, initial, state);
      let x = state[0]!; let y = state[1]!; let z = state[2]!; let w = state[3]!;
      for (let counter = counterStart; counter <= counterEnd; counter++) {
        if (matches(x, y, z, w, constraints)) found.push({ seed, counter });
        if (counter < counterEnd) {
          for (let n = 0; n < 10; n++) {
            const t = x ^ (x << 15);
            const next = w ^ (w >>> 21) ^ t ^ (t >>> 4);
            x = y; y = z; z = w; w = next;
          }
        }
      }
    }
    return found;
  };
}

export function predict(seed: number, weapon: number, attribute: number, counter: number, count: number) {
  return predictBonuses(seed, weapon, attribute, counter, count);
}

// R8 ordinary Artian: rarity enum 7 replaces attribute in the derived seed.
// IDs, equal-weight draws and per-category caps follow web/artian-base-rng.js.
export const artianBonuses = [
  { id: 4, name: '基础攻击力强化', cap: 5, category: 0 },
  { id: 6, name: '属性强化', cap: 4, category: 2 },
  { id: 7, name: '斩味／装填数强化', cap: 2, category: 3 },
  { id: 8, name: '会心率强化', cap: 3, category: 1 },
];

export function artianPool(weapon: number, attribute: number) {
  return artianBonuses.filter((b) => !(weapon === 11 && b.id === 7) && !((weapon >= 12 || attribute === 0) && b.id === 6));
}

export function predictArtian(seed: number, weapon: number, attribute: number, counter: number, count: number) {
  const state = new Uint32Array(4);
  jump(jumpTable(counter * 10), initialize(((seed + weapon * 1000 + 7) >>> 0) ^ 0x00ac9365), state);
  const local = new Uint32Array(4);
  return Array.from({ length: count }, () => {
    local.set(state);
    const available = artianPool(weapon, attribute).map((b) => ({ ...b, used: 0 }));
    const roll = Array.from({ length: 5 }, () => {
      const index = step(local) % available.length;
      const bonus = available[index]!;
      bonus.used++;
      if (bonus.used === bonus.cap) available.splice(index, 1);
      return bonus.id;
    });
    for (let n = 0; n < 10; n++) step(state);
    return roll;
  });
}

// Keep preserves the ordered categories, not the current tiers (GogmaSeedFinder rng-core).
export function predictKeep(seed: number, weapon: number, attribute: number, counter: number, count: number, layout: number[]) {
  const available = pool(weapon, attribute);
  if (layout.length !== 5 || layout.some((category) => !Number.isInteger(category) || !available.some((b) => b.category === category))) throw new Error('请按从左到右顺序填写武器当前五槽的有效类别');
  if (layout.filter((category) => category === 2).length > 4) throw new Error('属性加成最多四槽');
  if (layout.filter((category) => category === 3).length > 2) throw new Error('斩味／装填加成最多两槽');
  return predictBonuses(seed, weapon, attribute, counter, count, layout);
}

function predictBonuses(seed: number, weapon: number, attribute: number, counter: number, count: number, layout?: number[]) {
  const state = new Uint32Array(4);
  jump(jumpTable(counter * 10), initialize(((seed + weapon * 1000 + attribute) >>> 0) ^ 0x00ac9365), state);
  const candidates = pool(weapon, attribute).map((b) => b.id);
  const local = new Uint32Array(4);
  return Array.from({ length: count }, () => {
    local.set(state);
    const selected: number[] = [];
    for (let slot = 0; slot < 5; slot++) {
      const weights = candidates.map((id) => layout && categories[id] !== layout[slot] ? 0 : weight(id, selected));
      let value = step(local) % weights.reduce((a, b) => a + b, 0);
      const index = weights.findIndex((amount) => { value -= amount; return value < 0; });
      selected.push(candidates[index]!);
    }
    for (let n = 0; n < 10; n++) step(state);
    return selected;
  });
}

// Skill lottery order and sparse internal IDs follow rng-core at 65789e9.
export function predictSkills(seed: number, weapon: number, attribute: number, counter: number, count: number) {
  const state = new Uint32Array(4);
  jump(jumpTable(counter * 10), initialize(((seed + weapon * 1000 + attribute) >>> 0) ^ 0x00ac9365), state);
  step(state);
  return Array.from({ length: count }, (_, offset) => {
    if (offset > 0) for (let n = 0; n < 10; n++) step(state);
    const tableIndex = state[3]! % 294;
    const set = Math.floor(tableIndex / 14);
    const group = tableIndex % 14;
    const id = set === 0 ? [1, 2, 3, 4, 5, 7, 8, 9, 10, 11, 12, 13, 14, 15][group]! : 16 + (set - 1) * 15 + (group === 13 ? 14 : group);
    return { tableIndex, set, group, id };
  });
}
