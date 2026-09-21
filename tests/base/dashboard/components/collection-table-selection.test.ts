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

const ROWS = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];

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
    deepStrictEqual(deletableRows(ROWS, new Set(['c', 'a'])), [{ id: 'a' }, { id: 'c' }]);
  });

  it('keeps the row objects themselves', () => {
    strictEqual(deletableRows(ROWS, new Set(['b']))[0], ROWS[1]);
  });

  it('answers nothing for an empty verdict', () => {
    deepStrictEqual(deletableRows(ROWS, new Set()), []);
  });

  it('drops a row without a UUID', () => {
    deepStrictEqual(deletableRows([{ id: 0 }, { id: 'a' }], new Set(['0', 'a'])), [{ id: 'a' }]);
  });
});

describe('deletableSelection', () => {
  it('drops the rows the verdict refuses', () => {
    deepStrictEqual(deletableSelection({ a: true, b: true, c: true }, new Set(['a', 'c'])), {
      a: true,
      c: true,
    });
  });

  it('keeps a deselected entry as written', () => {
    deepStrictEqual(deletableSelection({ a: false, b: true }, new Set(['a'])), { a: false });
  });

  it('never selects a deletable row the selection does not carry', () => {
    deepStrictEqual(deletableSelection({ a: true }, new Set(['a', 'b'])), { a: true });
  });

  it('answers an empty selection for an empty verdict', () => {
    deepStrictEqual(deletableSelection({ a: true }, new Set()), {});
  });
});

describe('selectAllStateOf', () => {
  it('stays unchecked while a deletable row is unselected', () => {
    strictEqual(selectAllStateOf(ROWS, { a: true, b: true }, false, 1), false);
    strictEqual(selectAllStateOf(ROWS, { a: true, b: true, c: false }, false, 1), false);
  });

  it('checks a full lone page', () => {
    strictEqual(selectAllStateOf(ROWS, { a: true, b: true, c: true }, false, 1), true);
  });

  it('reads a full page among several as indeterminate', () => {
    strictEqual(selectAllStateOf(ROWS, { a: true, b: true, c: true }, false, 2), 'indeterminate');
  });

  it('checks a full page among several while every page is selected', () => {
    strictEqual(selectAllStateOf(ROWS, { a: true, b: true, c: true }, true, 2), true);
  });

  it('never checks for every page once a page row is deselected', () => {
    strictEqual(selectAllStateOf(ROWS, { a: true, b: true }, true, 2), false);
  });

  it('never checks a page without a deletable row', () => {
    strictEqual(selectAllStateOf([], {}, false, 1), false);
    strictEqual(selectAllStateOf([], {}, true, 2), false);
  });

  it('ignores rows outside the deletable ones', () => {
    const deletable = deletableRows(ROWS, new Set(['a', 'b']));
    strictEqual(selectAllStateOf(deletable, { a: true, b: true }, false, 1), true);
  });
});

describe('selectedCountOf', () => {
  it('counts the selected entries of the map', () => {
    strictEqual(selectedCountOf({ a: true, b: false, c: true }, false, 120), 2);
    strictEqual(selectedCountOf({}, false, 120), 0);
  });

  it('answers the count across the pages while every page is selected', () => {
    strictEqual(selectedCountOf({ a: true }, true, 120), 120);
  });
});
