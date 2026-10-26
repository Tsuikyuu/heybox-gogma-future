import { createSearch } from "./core.mjs";

// Upstream live Heavy Bowgun six-roll fixture, commit 65789e9.
const rolls = [[13, 6, 8, 12, 6], [13, 10, 12, 15, 6], [9, 15, 9, 16, 6], [12, 16, 6, 8, 9], [12, 13, 15, 6, 9], [15, 9, 6, 16, 12]];
const output = document.querySelector("#output");
const button = document.querySelector("#start");
let cancelled = false;
document.querySelector("#cancel").onclick = () => { cancelled = true; };
button.onclick = async () => {
  cancelled = false;
  delete output.dataset.done;
  button.disabled = true;
  const results = [{ userAgent: navigator.userAgent, hardwareConcurrency: navigator.hardwareConcurrency, targetSliceMs: 8 }];
  const render = () => { output.textContent = JSON.stringify(results, null, 2); };
  render();
  const params = new URLSearchParams(location.search);
  for (const width of (params.get("widths") ?? "1,11,101,1001,2001").split(",").map(Number)) {
    if (cancelled) break;
    const start = Math.max(0, 480 - Math.floor(width / 2));
    const setup = performance.now();
    const search = createSearch(12, 3, start, start + width - 1, rolls);
    const setupMs = performance.now() - setup;
    const first = params.has("first") ? Number(params.get("first")) : 86_300_000;
    const seeds = Number(params.get("seeds")) || (width >= 1001 ? 100_000 : 1_000_000);
    const end = first + seeds - 1;
    let next = first;
    let batch = 256;
    let computeMs = 0;
    let lastTick = performance.now();
    let maxTimerDelayMs = 0;
    const slices = [];
    const found = [];
    const timer = setInterval(() => {
      const now = performance.now();
      maxTimerDelayMs = Math.max(maxTimerDelayMs, now - lastTick - 16);
      lastTick = now;
    }, 16);
    const began = performance.now();
    while (next <= end && !cancelled) {
      const stop = Math.min(end, next + batch - 1);
      const chunk = performance.now();
      found.push(...search(next, stop));
      const elapsed = performance.now() - chunk;
      slices.push(elapsed);
      computeMs += elapsed;
      batch = Math.max(1, Math.min(50000, Math.floor(batch * Math.min(2, 8 / Math.max(0.1, elapsed)))));
      next = stop + 1;
      // A real task boundary: Promise.resolve() would not let rendering run.
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    clearInterval(timer);
    slices.sort((a, b) => a - b);
    results.push({ width, seeds: next - first, setupMs, wallMs: performance.now() - began, computeMs, p95SliceMs: slices[Math.floor(slices.length * 0.95)], maxSliceMs: slices.at(-1), maxTimerDelayMs, found, cancelled });
    render();
  }
  output.dataset.done = "true";
  button.disabled = false;
};
