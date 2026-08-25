import { deepStrictEqual, strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { History, unsavedChanges } from '../../../../src/layer/dashboard/components/history.ts';

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

describe('History', () => {
  it('pushes distinct states and dedupes equal ones', () => {
    const history = new History({ watchUnsavedChanges: false });
    history.push({ a: 1 }).push({ a: 1 }).push({ a: 2 });
    strictEqual(history.size.value, 2);
    strictEqual(history.getCurrentIndex(), 1);
    deepStrictEqual(history.getCurrentState(), { a: 2 });
  });

  it('seeds the original from the first push and tracks dirt', () => {
    const history = new History({ watchUnsavedChanges: false });
    history.push({ a: 1 });
    strictEqual(history.isDirty.value, false);
    history.push({ a: 2 });
    strictEqual(history.isDirty.value, true);
    deepStrictEqual(history.getOriginalState(), { a: 1 });
    history.setOriginalState({ a: 2 });
    strictEqual(history.isDirty.value, false);
  });

  it('ignores omitted keys in comparisons', () => {
    const history = new History({ omit: ['tab'], watchUnsavedChanges: false });
    history.push({ a: 1, tab: 'x' }).push({ a: 1, tab: 'y' });
    strictEqual(history.size.value, 1);
    history.push({ a: 2, tab: 'y' });
    strictEqual(history.isDirty.value, true);
    history.push({ a: 1, tab: 'z' });
    strictEqual(history.isDirty.value, false);
  });

  it('undoes and redoes with counters, clones on the way out', () => {
    const history = new History({ watchUnsavedChanges: false });
    const first = { a: 1 };
    history.push(first).push({ a: 2 }).push({ a: 3 });
    strictEqual(history.undoCount.value, 2);
    strictEqual(history.redoCount.value, 0);
    const undone = history.undo();
    deepStrictEqual(undone, { a: 2 });
    strictEqual(history.canRedo.value, true);
    deepStrictEqual(history.redo(), { a: 3 });
    history.undo();
    history.undo();
    deepStrictEqual(history.getCurrentState(), { a: 1 });
    strictEqual(history.getCurrentState() === first, false);
    strictEqual(history.undo(), undefined);
  });

  it('truncates the redo tail on push', () => {
    const history = new History({ watchUnsavedChanges: false });
    history.push({ a: 1 }).push({ a: 2 }).push({ a: 3 });
    history.undo();
    history.push({ a: 4 });
    strictEqual(history.canRedo.value, false);
    deepStrictEqual(history.getAllStates(), [{ a: 1 }, { a: 2 }, { a: 4 }]);
  });

  it('caps the stack at maxStates, dropping the oldest', () => {
    const history = new History({ maxStates: 2, watchUnsavedChanges: false });
    history.push({ a: 1 }).push({ a: 2 }).push({ a: 3 });
    strictEqual(history.size.value, 2);
    deepStrictEqual(history.getAllStates(), [{ a: 2 }, { a: 3 }]);
    deepStrictEqual(history.getOriginalState(), { a: 1 });
  });

  it('rewrites the current state, removing the requested count', () => {
    const history = new History({ watchUnsavedChanges: false });
    history.push({ a: 1 }).push({ a: 2 }).push({ a: 3 });
    history.rewrite({ a: 4 }, 2);
    deepStrictEqual(history.getAllStates(), [{ a: 1 }, { a: 4 }]);
    strictEqual(history.getCurrentIndex(), 1);
  });

  it('debounces pushes and blocks undo while one pends', async () => {
    const history = new History({ watchUnsavedChanges: false });
    history.push({ a: 1 }).push({ a: 2 });
    const pending = history.pushDebounced({ a: 3 }, 10);
    strictEqual(history.undo(), undefined);
    await pending;
    strictEqual(history.size.value, 3);
    deepStrictEqual(history.undo(), { a: 2 });
  });

  it('coalesces overlapping debounced pushes to the last state', async () => {
    const history = new History({ watchUnsavedChanges: false });
    history.push({ a: 1 });
    void history.pushDebounced({ a: 2 }, 10);
    await history.pushDebounced({ a: 3 }, 10);
    await sleep(20);
    deepStrictEqual(history.getAllStates(), [{ a: 1 }, { a: 3 }]);
  });

  it('clears everything, original and pending timer included', async () => {
    const history = new History({ watchUnsavedChanges: false });
    history.push({ a: 1 }).push({ a: 2 });
    void history.pushDebounced({ a: 3 }, 10);
    history.clear();
    strictEqual(history.size.value, 0);
    strictEqual(history.getCurrentIndex(), -1);
    strictEqual(history.getOriginalState(), undefined);
    strictEqual(history.isDirty.value, false);
    await sleep(20);
    strictEqual(history.size.value, 0);
  });

  it('registers on the unsavedChanges global unless opted out', () => {
    const watching = new History();
    strictEqual(unsavedChanges.history, watching);
    new History({ watchUnsavedChanges: false });
    strictEqual(unsavedChanges.history, watching);
    unsavedChanges.history = null;
  });
});
