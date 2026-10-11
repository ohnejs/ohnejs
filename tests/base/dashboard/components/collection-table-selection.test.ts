import { deepStrictEqual, strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import {
  admitsRow,
  deletableRows,
  deletableSelection,
  pageUUIDs,
  selectAllStateOf,
  selectedCountOf,
} from '../../../../src/base/dashboard/components/collection-table-selection.ts';

const ROWS = [{ UUID: 'a' }, { UUID: 'b' }, { UUID: 'c' }];

describe('pageUUIDs', () => {
  it('reads the UUIDs in page order', () => {
    deepStrictEqual(pageUUIDs([{ UUID: 'b' }, { UUID: 'a', title: 'One' }]), ['b', 'a']);
  });

  it('skips a record without a string UUID', () => {
    deepStrictEqual(pageUUIDs([{ title: 'One' }, { UUID: 7 }, { UUID: 'a' }]), ['a']);
  });
});

describe('admitsRow', () => {
  it('admits a UUID the verdict holds', () => {
    strictEqual(admitsRow(new Set(['a']), 'a'), true);
    strictEqual(admitsRow(new Set(['a']), 'b'), false);
  });

  it('never admits a row identified by its page index', () => {
    strictEqual(admitsRow(new Set(['0']), 0), false);
  });
});

describe('deletableRows', () => {
  it('keeps the admitted rows in page order', () => {
    deepStrictEqual(deletableRows(ROWS, new Set(['c', 'a'])), [{ UUID: 'a' }, { UUID: 'c' }]);
  });

  it('keeps the row objects themselves', () => {
    strictEqual(deletableRows(ROWS, new Set(['b']))[0], ROWS[1]);
  });

  it('answers nothing for an empty verdict', () => {
    deepStrictEqual(deletableRows(ROWS, new Set()), []);
  });

  it('drops a row without a UUID', () => {
    deepStrictEqual(deletableRows([{}, { UUID: 'a' }], new Set(['a'])), [{ UUID: 'a' }]);
  });
});

describe('deletableSelection', () => {
  it('drops the rows the verdict refuses', () => {
    deepStrictEqual(
      deletableSelection(new Set(['a', 'b', 'c']), new Set(['a', 'c'])),
      new Set(['a', 'c']),
    );
  });

  it('keeps the selection order', () => {
    deepStrictEqual(
      [...deletableSelection(new Set(['c', 'a', 'b']), new Set(['a', 'b', 'c']))],
      ['c', 'a', 'b'],
    );
  });

  it('drops a page index key', () => {
    deepStrictEqual(deletableSelection(new Set([0, 'a']), new Set(['0', 'a'])), new Set(['a']));
  });

  it('never selects a deletable row the selection does not carry', () => {
    deepStrictEqual(deletableSelection(new Set(['a']), new Set(['a', 'b'])), new Set(['a']));
  });

  it('answers an empty selection for an empty verdict', () => {
    deepStrictEqual(deletableSelection(new Set(['a']), new Set()), new Set());
  });
});

describe('selectAllStateOf', () => {
  it('stays unchecked while a deletable row is unselected', () => {
    strictEqual(selectAllStateOf(ROWS, new Set(['a', 'b']), false, 1), false);
  });

  it('checks a full lone page', () => {
    strictEqual(selectAllStateOf(ROWS, new Set(['a', 'b', 'c']), false, 1), true);
  });

  it('reads a full page among several as indeterminate', () => {
    strictEqual(selectAllStateOf(ROWS, new Set(['a', 'b', 'c']), false, 2), 'indeterminate');
  });

  it('checks a full page among several while every page is selected', () => {
    strictEqual(selectAllStateOf(ROWS, new Set(['a', 'b', 'c']), true, 2), true);
  });

  it('never checks for every page once a page row is deselected', () => {
    strictEqual(selectAllStateOf(ROWS, new Set(['a', 'b']), true, 2), false);
  });

  it('never checks a page without a deletable row', () => {
    strictEqual(selectAllStateOf([], new Set(), false, 1), false);
    strictEqual(selectAllStateOf([], new Set(), true, 2), false);
  });

  it('ignores rows outside the deletable ones', () => {
    const deletable = deletableRows(ROWS, new Set(['a', 'b']));
    strictEqual(selectAllStateOf(deletable, new Set(['a', 'b']), false, 1), true);
  });
});

describe('selectedCountOf', () => {
  it('counts the selected keys', () => {
    strictEqual(selectedCountOf(new Set(['a', 'c']), false, 120), 2);
    strictEqual(selectedCountOf(new Set(), false, 120), 0);
  });

  it('answers the count across the pages while every page is selected', () => {
    strictEqual(selectedCountOf(new Set(['a']), true, 120), 120);
  });
});
