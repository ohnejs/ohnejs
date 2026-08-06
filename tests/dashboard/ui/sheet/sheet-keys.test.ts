import { deepStrictEqual, strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { type SheetActions, sheetKeymap } from '../../../../src/dashboard/ui/sheet/sheet-keys.ts';

function recorder() {
  const calls: unknown[][] = [];
  const actions: SheetActions = {
    move: (dx, dy, extend) => void calls.push(['move', dx, dy, extend]),
    selectAll: () => void calls.push(['selectAll']),
    clear: () => void calls.push(['clear']),
    page: (delta) => void calls.push(['page', delta]),
    edit: () => void calls.push(['edit']),
  };
  return { calls, actions };
}

function stroke(
  key: string,
  modifiers: Partial<Record<'ctrl' | 'alt' | 'shift' | 'meta', boolean>> = {},
) {
  return {
    key,
    ctrl: modifiers.ctrl ?? false,
    alt: modifiers.alt ?? false,
    shift: modifiers.shift ?? false,
    meta: modifiers.meta ?? false,
  };
}

describe('sheet keymap', () => {
  it('maps arrows to moves, shifted to stretches', () => {
    const { calls, actions } = recorder();
    const match = sheetKeymap(actions);
    strictEqual(match(stroke('ArrowDown')), true);
    strictEqual(match(stroke('ArrowLeft', { shift: true })), true);
    deepStrictEqual(calls, [
      ['move', 0, 1, false],
      ['move', -1, 0, true],
    ]);
  });

  it('jumps the row with Home and End', () => {
    const { calls, actions } = recorder();
    const match = sheetKeymap(actions);
    match(stroke('Home'));
    match(stroke('End'));
    deepStrictEqual(calls, [
      ['move', -Infinity, 0, false],
      ['move', Infinity, 0, false],
    ]);
  });

  it('selects all on mod+a per platform', () => {
    const { calls, actions } = recorder();
    const match = sheetKeymap(actions, { platform: 'mac' });
    strictEqual(match(stroke('a', { meta: true })), true);
    strictEqual(match(stroke('a', { ctrl: true })), false);
    deepStrictEqual(calls, [['selectAll']]);
  });

  it('steps pages, edits, and clears', () => {
    const { calls, actions } = recorder();
    const match = sheetKeymap(actions);
    match(stroke('PageUp'));
    match(stroke('PageDown'));
    match(stroke('Enter'));
    match(stroke('Escape'));
    deepStrictEqual(calls, [['page', -1], ['page', 1], ['edit'], ['clear']]);
  });

  it('leaves unbound strokes unhandled', () => {
    const { calls, actions } = recorder();
    const match = sheetKeymap(actions);
    strictEqual(match(stroke('x')), false);
    strictEqual(match(stroke('ArrowDown', { alt: true })), false);
    deepStrictEqual(calls, []);
  });
});
