import { deepStrictEqual, strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { effectScope } from '../../../../src/utils/index.ts';
import { baseBrowser } from '../_browser.ts';

baseBrowser('/');
const { History } = await import('../../../../src/base/dashboard/components/history.ts');
const { hasUnsavedChanges } = await import('../../../../src/dashboard/router/unsaved-changes.ts');

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

  it('keeps an empty first push as the original, as a blank create form seeds it', () => {
    const history = new History<Record<string, string>>({ watchUnsavedChanges: false });
    history.push({}).push({ title: 'Hello' });
    strictEqual(history.isDirty.value, true);
    deepStrictEqual(history.getOriginalState(), {});
    deepStrictEqual(history.undo(), {});
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

  it('debounces pushes, and an undo lands the pending one before stepping back', async () => {
    const history = new History({ watchUnsavedChanges: false });
    history.push({ a: 1 }).push({ a: 2 });
    void history.pushDebounced({ a: 3 }, 10);
    strictEqual(history.size.value, 2);
    deepStrictEqual(history.undo(), { a: 2 });
    deepStrictEqual(history.redo(), { a: 3 });
    await sleep(20);
    strictEqual(history.size.value, 3);
  });

  it('lands a pending push before a redo, which then has nothing left to redo', () => {
    const history = new History({ watchUnsavedChanges: false });
    history.push({ a: 1 }).push({ a: 2 });
    history.undo();
    void history.pushDebounced({ a: 9 }, 10);
    strictEqual(history.redo(), undefined);
    deepStrictEqual(history.getCurrentState(), { a: 9 });
  });

  it('counts a pending push that changes the state as a step already landed', () => {
    const history = new History({ watchUnsavedChanges: false });
    history.push({ a: 1 }).push({ a: 2 });
    history.undo();
    void history.pushDebounced({ a: 3 }, 1000);
    deepStrictEqual(
      [
        history.canUndo.value,
        history.undoCount.value,
        history.canRedo.value,
        history.redoCount.value,
      ],
      [true, 1, false, 0],
    );
    strictEqual(history.isDirty.value, true);
    void history.pushDebounced({ a: 1 }, 1000);
    deepStrictEqual(
      [
        history.canUndo.value,
        history.undoCount.value,
        history.canRedo.value,
        history.redoCount.value,
      ],
      [false, 0, true, 1],
    );
    strictEqual(history.isDirty.value, false);
    history.clear();
  });

  it('counts a pending push on a full stack without passing the cap', () => {
    const history = new History({ watchUnsavedChanges: false, maxStates: 2 });
    history.push({ a: 1 }).push({ a: 2 });
    void history.pushDebounced({ a: 3 }, 1000);
    strictEqual(history.undoCount.value, 1);
    history.flush();
    strictEqual(history.undoCount.value, 1);
  });

  it('says whether a debounced push waits to land', async () => {
    const history = new History({ watchUnsavedChanges: false });
    history.push({ a: 1 });
    strictEqual(history.isPending(), false);
    const pending = history.pushDebounced({ a: 2 }, 1000);
    strictEqual(history.isPending(), true);
    history.flush();
    await pending;
    strictEqual(history.isPending(), false);
  });

  it('resolves a debounced push when a flush lands it', async () => {
    const history = new History({ watchUnsavedChanges: false });
    history.push({ a: 1 });
    const pending = history.pushDebounced({ a: 2 }, 1000);
    history.flush();
    strictEqual(await pending, history);
    deepStrictEqual(history.getCurrentState(), { a: 2 });
  });

  it('coalesces overlapping debounced pushes to the last state', async () => {
    const history = new History({ watchUnsavedChanges: false });
    history.push({ a: 1 });
    void history.pushDebounced({ a: 2 }, 10);
    await history.pushDebounced({ a: 3 }, 10);
    await sleep(20);
    deepStrictEqual(history.getAllStates(), [{ a: 1 }, { a: 3 }]);
  });

  it('drops a pending debounced push once a direct push lands, as after a save', async () => {
    const history = new History({ watchUnsavedChanges: false });
    history.push({ a: 1 });
    void history.pushDebounced({ a: 2 }, 10);
    history.push({ a: 2, id: 'saved' }).setOriginalState({ a: 2, id: 'saved' });
    await sleep(20);
    deepStrictEqual(history.getAllStates(), [{ a: 1 }, { a: 2, id: 'saved' }]);
    strictEqual(history.isDirty.value, false);
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

  it('guards its dirty state until its scope is disposed, unless opted out', () => {
    const scope = effectScope();
    scope.run(() => new History({ watchUnsavedChanges: false }).push({ a: 1 }).push({ a: 2 }));
    strictEqual(hasUnsavedChanges(), false);
    const watching = scope.run(() => new History().push({ a: 1 }));
    strictEqual(hasUnsavedChanges(), false);
    watching.push({ a: 2 });
    strictEqual(hasUnsavedChanges(), true);
    scope.dispose();
    strictEqual(hasUnsavedChanges(), false);
  });

  it('keeps an outer history guarded when a nested one is disposed', () => {
    const page = effectScope();
    page.run(() => new History().push({ a: 1 }).push({ a: 2 }));
    const popup = page.run(() => effectScope());
    popup.run(() => new History().push({ b: 1 }));
    popup.dispose();
    strictEqual(hasUnsavedChanges(), true);
    page.dispose();
    strictEqual(hasUnsavedChanges(), false);
  });
});
