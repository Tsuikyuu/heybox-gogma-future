import { createSearch } from './engine';
import type { Task } from './model';

// Counter tiles keep even an extremely wide search responsive. The cursor is
// the first unprocessed seed in the current tile, never just a percentage.
export async function runSearch(input: Task, options: {
  stopped: () => boolean;
  progress: (task: Task, perSecond: number) => void;
  save: (task: Task) => Promise<void>;
}) {
  let task = structuredClone(input);
  let batch = 64;
  let lastSave = performance.now();
  let rate = 0;
  while (task.nextCounter <= task.counterEnd && !options.stopped()) {
    const counterEnd = Math.min(task.counterEnd, task.nextCounter + 31);
    const search = createSearch(task.weapon, task.attribute, task.nextCounter, counterEnd, task.rolls);
    while (task.nextSeed <= task.seedEnd && !options.stopped()) {
      const end = Math.min(task.seedEnd, task.nextSeed + batch - 1);
      const begin = performance.now();
      const found = search(task.nextSeed, end);
      const elapsed = Math.max(0.1, performance.now() - begin);
      if (task.candidates.length + found.length > 2000) {
        task.status = 'overflow';
        await options.save(task);
        options.progress(task, rate);
        return task;
      }
      rate = (end - task.nextSeed + 1) * (counterEnd - task.nextCounter + 1) / elapsed * 1000;
      task = { ...task, nextSeed: end + 1, candidates: [...task.candidates, ...found] };
      batch = Math.max(1, Math.min(30000, Math.floor(batch * Math.min(2, 8 / elapsed))));
      if (performance.now() - lastSave > 1500) {
        await options.save(task);
        lastSave = performance.now();
      }
      options.progress(task, rate);
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    if (task.nextSeed > task.seedEnd) task = { ...task, nextSeed: task.seedStart, nextCounter: counterEnd + 1 };
  }
  task.status = task.nextCounter > task.counterEnd ? 'complete' : 'paused';
  await options.save(task);
  options.progress(task, rate);
  return task;
}

export function searchProgress(t: Task) {
  const width = t.seedEnd - t.seedStart + 1;
  const total = width * (t.counterEnd - t.counterStart + 1);
  const done = (t.nextCounter - t.counterStart) * width +
    (t.nextCounter <= t.counterEnd ? (t.nextSeed - t.seedStart) * Math.min(32, t.counterEnd - t.nextCounter + 1) : 0);
  return { done, total, percent: Math.min(100, done / total * 100) };
}
