import { deepStrictEqual, strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { createSheetSelection } from '../../../../src/dashboard/ui/sheet/selection.ts';

function grid(rows: number, columns: number) {
  return createSheetSelection(() => ({ rows, columns }));
}

describe('set and range', () => {
  it('starts empty', () => {
    const selection = grid(5, 3);
    strictEqual(selection.range(), null);
    strictEqual(selection.focus(), null);
    strictEqual(selection.isSelected(0, 0), false);
  });

  it('collapses to one clamped cell', () => {
    const selection = grid(5, 3);
    selection.set({ row: 9, column: 9 });
    deepStrictEqual(selection.range(), { top: 4, left: 2, bottom: 4, right: 2 });
    strictEqual(selection.isFocus(4, 2), true);
  });

  it('normalizes the rectangle whichever way it is spanned', () => {
    const selection = grid(5, 3);
    selection.set({ row: 3, column: 2 });
    selection.extend({ row: 1, column: 0 });
    deepStrictEqual(selection.range(), { top: 1, left: 0, bottom: 3, right: 2 });
    strictEqual(selection.isSelected(2, 1), true);
    strictEqual(selection.isSelected(4, 1), false);
  });

  it('extend with no anchor collapses to the cell', () => {
    const selection = grid(5, 3);
    selection.extend({ row: 2, column: 1 });
    deepStrictEqual(selection.range(), { top: 2, left: 1, bottom: 2, right: 1 });
  });
});

describe('move', () => {
  it('lands on the first cell when nothing is selected', () => {
    const selection = grid(5, 3);
    selection.move(1, 1, false);
    deepStrictEqual(selection.focus(), { row: 0, column: 0 });
  });

  it('moves and clamps at the edges', () => {
    const selection = grid(2, 2);
    selection.set({ row: 0, column: 0 });
    selection.move(0, 1, false);
    selection.move(0, 1, false);
    deepStrictEqual(selection.focus(), { row: 1, column: 0 });
    selection.move(-1, 0, false);
    deepStrictEqual(selection.focus(), { row: 1, column: 0 });
  });

  it('jumps to the row edge on an infinite delta', () => {
    const selection = grid(3, 7);
    selection.set({ row: 1, column: 3 });
    selection.move(Infinity, 0, false);
    deepStrictEqual(selection.focus(), { row: 1, column: 6 });
    selection.move(-Infinity, 0, false);
    deepStrictEqual(selection.focus(), { row: 1, column: 0 });
  });

  it('stretches from the anchor when extending', () => {
    const selection = grid(5, 3);
    selection.set({ row: 1, column: 1 });
    selection.move(1, 0, true);
    selection.move(0, 1, true);
    deepStrictEqual(selection.range(), { top: 1, left: 1, bottom: 2, right: 2 });
    deepStrictEqual(selection.anchor(), { row: 1, column: 1 });
  });

  it('a plain move collapses an extended range', () => {
    const selection = grid(5, 3);
    selection.set({ row: 1, column: 1 });
    selection.move(1, 0, true);
    selection.move(0, 1, false);
    deepStrictEqual(selection.range(), { top: 2, left: 2, bottom: 2, right: 2 });
  });
});

describe('rows and all', () => {
  it('selects the whole grid', () => {
    const selection = grid(4, 3);
    selection.selectAll();
    deepStrictEqual(selection.range(), { top: 0, left: 0, bottom: 3, right: 2 });
  });

  it('selectAll on an empty grid stays empty', () => {
    const selection = grid(0, 3);
    selection.selectAll();
    strictEqual(selection.range(), null);
  });

  it('selects one full row, and stretches rows when extending', () => {
    const selection = grid(5, 3);
    selection.selectRow(2);
    deepStrictEqual(selection.range(), { top: 2, left: 0, bottom: 2, right: 2 });
    selection.selectRow(4, true);
    deepStrictEqual(selection.range(), { top: 2, left: 0, bottom: 4, right: 2 });
  });

  it('clears', () => {
    const selection = grid(5, 3);
    selection.selectAll();
    selection.clear();
    strictEqual(selection.range(), null);
  });
});
