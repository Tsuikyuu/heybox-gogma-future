import { cpus } from "node:os";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { strict } from "node:assert";
import { createSearch, initialize, predict } from "./core.mjs";

// Usage: bun experiments/gogma-js/benchmark.mjs /path/to/GogmaSeedFinder
const upstream = resolve(process.argv[2]);
const { initSync, GogmaCounterSearchSession, predict_gogma_rolls } = await import(pathToFileURL(resolve(upstream, "web/pkg/gogma_wasm_search.js")));
initSync({ module: new Uint8Array(await Bun.file(resolve(upstream, "web/pkg/gogma_wasm_search_bg.wasm")).arrayBuffer()) });
const fixtureNames = ["gogma_reset_stream_v0.9.3_live.json", "gogma_bow_reset_stream_live_2026-08-23.json", "gogma_heavy_bowgun_reset_stream_live_2026-08-23.json"];
let verified = 0;
for (const name of fixtureNames) {
  const fixture = await Bun.file(resolve(upstream, "tests/fixtures", name)).json();
  for (const item of fixture.cases) {
    strict.deepEqual([...initialize(item.effectiveSeed)], Object.values(item.initializedState));
    strict.deepEqual([...predict(item.baseSeed, item.weaponType, item.attributeForce, item.gogmaCounter, item.rolls.length)], item.rolls.flatMap((roll) => roll.bonusIds));
    const search = createSearch(item.weaponType, item.attributeForce, Math.max(0, item.gogmaCounter - 5), item.gogmaCounter + 5, item.rolls.map((roll) => roll.bonusIds));
    strict.deepEqual(search(item.baseSeed - 100, item.baseSeed + 100), [item.baseSeed, item.gogmaCounter]);
    verified++;
  }
}
// Differential checks include all weapon types, non-elemental pools, u32
// wrapping seeds and counters large enough to exercise logarithmic jumping.
for (let weapon = 0; weapon < 14; weapon++) {
  for (const attribute of [0, 3, 4]) {
    for (const seed of [0, 86315169, 0xffffffff]) {
      const counter = weapon * 193 + 480;
      const expected = predict_gogma_rolls(seed, weapon, attribute, counter, 200, 30);
      strict.deepEqual(predict(seed, weapon, attribute, counter, 30), expected);
      const rolls = Array.from({ length: 6 }, (_, i) => [...expected.slice(i * 5, i * 5 + 5)]);
      const search = createSearch(weapon, attribute, counter - 3, counter + 3, rolls);
      const start = Math.max(0, seed - 10);
      const end = Math.min(0xffffffff, seed + 10);
      const wasm = new GogmaCounterSearchSession(weapon, attribute, 200, counter - 3, counter + 3, new Uint8Array(rolls.flat()), start, end);
      strict.deepEqual(search(start, end), [...wasm.search_next(100)]);
      wasm.free();
      verified++;
    }
  }
}
console.log(JSON.stringify({ verificationCases: verified, runtime: `Bun ${Bun.version}`, cpu: cpus()[0].model }));

const sample = (await Bun.file(resolve(upstream, "tests/fixtures/gogma_heavy_bowgun_reset_stream_live_2026-08-23.json")).json()).cases[0];
const rolls = sample.rolls.map((roll) => roll.bonusIds);
for (const width of [1, 11, 101, 1001, 2001]) {
  const seeds = width >= 1001 ? 100_000 : 1_000_000;
  const first = 86_300_000;
  const start = Math.max(0, 480 - Math.floor(width / 2));
  const setup = performance.now();
  const search = createSearch(12, 3, start, start + width - 1, rolls);
  const setupMs = performance.now() - setup;
  search(86_000_000, 86_009_999);
  const results = [];
  for (let repeat = 0; repeat < 3; repeat++) {
    const began = performance.now();
    const found = search(first, first + seeds - 1);
    const jsMs = performance.now() - began;
    const wasm = new GogmaCounterSearchSession(12, 3, 200, start, start + width - 1, new Uint8Array(rolls.flat()), first, first + seeds - 1);
    const wasmStart = performance.now();
    const expected = [...wasm.search_next(1_000_000)];
    const wasmMs = performance.now() - wasmStart;
    strict.deepEqual(found, expected);
    strict.deepEqual(found, [86315169, 480]);
    wasm.free();
    results.push({ jsMs, wasmMs });
  }
  console.log(JSON.stringify({ width, seeds, setupMs, results }));
}
const began = performance.now();
const output = predict(86315169, 12, 3, 480, 10000);
const predictionMs = performance.now() - began;
strict.deepEqual(output, predict_gogma_rolls(86315169, 12, 3, 480, 200, 10000));
console.log(JSON.stringify({ predictionRows: 10000, jsMs: predictionMs }));
