// Evaluation prototype adapted from GogmaSeedFinder 65789e9 (MIT; see LICENSE).
// Only Reset search with an active counter gate is evaluated here.
const order = [8, 12, 15, 9, 13, 16, 11, 14, 6, 10];
const categories = { 8: 0, 12: 0, 15: 0, 9: 1, 13: 1, 16: 1, 11: 2, 14: 2, 6: 3, 10: 3 };

export function initialize(seed, state = new Uint32Array(4)) {
  let x = 0x159a55e5;
  let y = 0x1f123bb5;
  let z = 0x05491333;
  let w = z;
  for (let i = 1; i <= 100; i++) {
    const mixed = (0x65ac9365 >>> (seed & 3)) ^ seed;
    seed = (mixed << 4) ^ (mixed << 3) ^ (mixed >>> 3) ^ (mixed >>> 4) ^ mixed;
    const t = seed ^ (seed << 15);
    w = z ^ (z >>> 21) ^ t ^ (t >>> 4);
    if (i < 100) {
      x = y;
      y = z;
      z = w;
    }
  }
  state[0] = x;
  state[1] = y;
  state[2] = z;
  state[3] = w;
  return state;
}

function step(state) {
  const t = state[0] ^ (state[0] << 15);
  const w = state[3] ^ (state[3] >>> 21) ^ t ^ (t >>> 4);
  state[0] = state[1];
  state[1] = state[2];
  state[2] = state[3];
  state[3] = w;
  return w >>> 0;
}

function apply(columns, state, out) {
  out.fill(0);
  for (let word = 0; word < 4; word++) {
    let bits = state[word];
    while (bits !== 0) {
      const index = (word * 32 + 31 - Math.clz32(bits & -bits)) * 4;
      for (let k = 0; k < 4; k++) out[k] ^= columns[index + k];
      bits &= bits - 1;
    }
  }
}

function compose(after, before) {
  const out = new Uint32Array(512);
  for (let i = 0; i < 128; i++) apply(after, before.subarray(i * 4, i * 4 + 4), out.subarray(i * 4, i * 4 + 4));
  return out;
}

function jumpTable(steps) {
  let result = new Uint32Array(512);
  for (let i = 0; i < 128; i++) result[i * 4 + Math.floor(i / 32)] = 1 << (i % 32);
  let power = result.slice();
  for (let i = 0; i < 128; i++) step(power.subarray(i * 4, i * 4 + 4));
  while (steps > 0) {
    if (steps % 2) result = compose(power, result);
    steps = Math.floor(steps / 2);
    if (steps > 0) power = compose(power, power);
  }
  // 16 byte positions × 256 values × four u32 outputs = 64 KiB.
  // This replaces per-seed bit scanning with 16 lookup/XOR operations.
  const table = new Uint32Array(16 * 256 * 4);
  for (let byte = 0; byte < 16; byte++) {
    for (let value = 1; value < 256; value++) {
      const bit = 31 - Math.clz32(value & -value);
      const previous = (byte * 256 + (value & (value - 1))) * 4;
      const index = (byte * 256 + value) * 4;
      for (let k = 0; k < 4; k++) table[index + k] = table[previous + k] ^ result[(byte * 8 + bit) * 4 + k];
    }
  }
  return table;
}

function jump(table, state, out) {
  let x = 0;
  let y = 0;
  let z = 0;
  let w = 0;
  for (let byte = 0; byte < 16; byte++) {
    const index = (byte * 256 + ((state[byte >>> 2] >>> ((byte & 3) * 8)) & 255)) * 4;
    x ^= table[index];
    y ^= table[index + 1];
    z ^= table[index + 2];
    w ^= table[index + 3];
  }
  out[0] = x;
  out[1] = y;
  out[2] = z;
  out[3] = w;
}

function weight(id, selected) {
  const category = categories[id];
  if (selected.filter((value) => categories[value] === category).length >= (category === 3 ? 2 : 5)) return 0;
  return Math.max(0, 100 - selected.filter((value) => value === id).length * ([10, 14, 15, 16].includes(id) ? 80 : 50));
}

function pool(weapon, attribute) {
  return order.filter((id) => !(weapon === 11 && categories[id] === 3) && !((weapon >= 12 || attribute === 0) && categories[id] === 2));
}

export function compile(weapon, attribute, rolls) {
  const candidates = pool(weapon, attribute);
  return new Uint32Array(rolls.flatMap((roll) => {
    if (roll.length !== 5) throw new Error("Expected five ordered slots");
    return roll.flatMap((id, slot) => {
      const weights = candidates.map((value) => weight(value, roll.slice(0, slot)));
      const index = candidates.indexOf(id);
      if (index < 0 || weights[index] === 0) throw new Error("Impossible observation");
      const start = weights.slice(0, index).reduce((a, b) => a + b, 0);
      return [weights.reduce((a, b) => a + b, 0), start, start + weights[index]];
    });
  }));
}

function matches(x, y, z, w, constraints) {
  for (let offset = 0; offset < constraints.length; offset += 15) {
    // Five observed transitions, then five skipped transitions to the next row.
    for (let slot = 0; slot < 10; slot++) {
      const t = x ^ (x << 15);
      const next = w ^ (w >>> 21) ^ t ^ (t >>> 4);
      x = y;
      y = z;
      z = w;
      w = next;
      if (slot >= 5) continue;
      const index = offset + slot * 3;
      const value = (w >>> 0) % constraints[index];
      if (value < constraints[index + 1] || value >= constraints[index + 2]) return false;
    }
  }
  return true;
}

export function createSearch(weapon, attribute, counterStart, counterEnd, rolls) {
  if (!Number.isInteger(counterStart) || counterStart < 0 || counterEnd < counterStart || counterEnd > 0xffffffff || !Number.isInteger(counterEnd) || !rolls.length) throw new Error("Invalid search range or observations");
  const constraints = compile(weapon, attribute, rolls);
  const table = jumpTable(counterStart * 10);
  const initial = new Uint32Array(4);
  const state = new Uint32Array(4);
  return (seedStart, seedEnd) => {
    const found = [];
    for (let seed = seedStart; seed <= seedEnd; seed++) {
      initialize(((seed + weapon * 1000 + attribute) >>> 0) ^ 0x00ac9365, initial);
      jump(table, initial, state);
      let x = state[0];
      let y = state[1];
      let z = state[2];
      let w = state[3];
      for (let counter = counterStart; counter <= counterEnd; counter++) {
        if (matches(x, y, z, w, constraints)) found.push(seed, counter);
        if (counter < counterEnd) {
          for (let n = 0; n < 10; n++) {
            const t = x ^ (x << 15);
            const next = w ^ (w >>> 21) ^ t ^ (t >>> 4);
            x = y;
            y = z;
            z = w;
            w = next;
          }
        }
      }
    }
    return found;
  };
}

export function predict(seed, weapon, attribute, counter, count) {
  const state = new Uint32Array(4);
  jump(jumpTable(counter * 10), initialize(((seed + weapon * 1000 + attribute) >>> 0) ^ 0x00ac9365), state);
  const candidates = pool(weapon, attribute);
  const local = new Uint32Array(4);
  const output = new Uint8Array(count * 5);
  for (let row = 0; row < count; row++) {
    local.set(state);
    const selected = [];
    for (let slot = 0; slot < 5; slot++) {
      const weights = candidates.map((id) => weight(id, selected));
      let value = step(local) % weights.reduce((a, b) => a + b, 0);
      const index = weights.findIndex((amount) => {
        value -= amount;
        return value < 0;
      });
      selected.push(candidates[index]);
      output[row * 5 + slot] = candidates[index];
    }
    for (let n = 0; n < 10; n++) step(state);
  }
  return output;
}
