import { deepStrictEqual, notStrictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { rangeSelect, sortRows, toggleSort } from '../../../src/dashboard/ui/table-model.ts';

interface Row {
  id: number;
}

const key = (row: Row): number => row.id;

function rows(...ids: number[]): Row[] {
  return ids.map((id) => ({ id }));
}

describe('toggleSort', () => {
  it('starts ascending from no sort', () => {
    deepStrictEqual(toggleSort(null, 'name'), { column: 'name', direction: 'asc' });
  });

  it('flips the direction on the same column', () => {
    deepStrictEqual(toggleSort({ column: 'name', direction: 'asc' }, 'name'), {
      column: 'name',
      direction: 'desc',
    });
    deepStrictEqual(toggleSort({ column: 'name', direction: 'desc' }, 'name'), {
      column: 'name',
      direction: 'asc',
    });
  });

  it('starts ascending on a different column', () => {
    deepStrictEqual(toggleSort<string>({ column: 'name', direction: 'desc' }, 'id'), {
      column: 'id',
      direction: 'asc',
    });
  });
});

describe('rangeSelect', () => {
  it('selects the inclusive range from the anchor down', () => {
    deepStrictEqual([...rangeSelect(rows(1, 2, 3, 4), key, new Set(), 1, 3, true)], [1, 2, 3]);
  });

  it('selects the inclusive range from the anchor up, in row order', () => {
    deepStrictEqual([...rangeSelect(rows(1, 2, 3, 4), key, new Set([4]), 4, 2, true)], [4, 2, 3]);
  });

  it('keeps the place of keys already selected and appends new ones', () => {
    deepStrictEqual(
      [...rangeSelect(rows(1, 2, 3, 4), key, new Set([9, 3, 1]), 1, 4, true)],
      [9, 3, 1, 2, 4],
    );
  });

  it('keeps the anchor selected when deselecting a range', () => {
    deepStrictEqual([...rangeSelect(rows(1, 2, 3), key, new Set([1, 2, 3]), 1, 3, false)], [1]);
  });

  it('keeps keys outside the rows, so a selection survives paging', () => {
    deepStrictEqual([...rangeSelect(rows(1, 2), key, new Set([7]), 1, 2, false)], [7, 1]);
  });

  it('skips the rows the predicate refuses', () => {
    const selectable = (row: Row): boolean => row.id !== 2;
    deepStrictEqual(
      [...rangeSelect(rows(1, 2, 3), key, new Set(), 1, 3, true, selectable)],
      [1, 3],
    );
    deepStrictEqual(
      [...rangeSelect(rows(1, 2, 3), key, new Set([2, 3]), 1, 3, false, selectable)],
      [2, 1],
    );
  });

  it('never selects an anchor the predicate refuses', () => {
    const selectable = (row: Row): boolean => row.id !== 1;
    deepStrictEqual(
      [...rangeSelect(rows(1, 2, 3), key, new Set(), 1, 3, true, selectable)],
      [2, 3],
    );
  });

  it('keys rows by index when the key reads it', () => {
    const byIndex = (_: Row, index: number): number => index;
    deepStrictEqual([...rangeSelect(rows(5, 6, 7), byIndex, new Set(), 2, 0, true)], [0, 1, 2]);
  });

  it('returns a fresh set', () => {
    const selected = new Set([1]);
    notStrictEqual(rangeSelect(rows(1, 2), key, selected, 1, 2, true), selected);
    deepStrictEqual(selected, new Set([1]));
  });
});

describe('sortRows', () => {
  const name = (row: { n: string | number | null | undefined }) => row.n;

  it('compares numbers as numbers', () => {
    deepStrictEqual(sortRows([{ n: 10 }, { n: 9 }, { n: 100 }], name, 'asc'), [
      { n: 9 },
      { n: 10 },
      { n: 100 },
    ]);
  });

  it('compares text in natural order', () => {
    deepStrictEqual(sortRows([{ n: 'raid 11' }, { n: 'raid 2' }, { n: 'Raid 1' }], name, 'asc'), [
      { n: 'Raid 1' },
      { n: 'raid 2' },
      { n: 'raid 11' },
    ]);
  });

  it('reverses for a descending sort', () => {
    deepStrictEqual(sortRows([{ n: 'a' }, { n: 'c' }, { n: 'b' }], name, 'desc'), [
      { n: 'c' },
      { n: 'b' },
      { n: 'a' },
    ]);
  });

  it('sorts missing values last in both directions', () => {
    const list = [{ n: null }, { n: 2 }, { n: undefined }, { n: Number.NaN }, { n: 1 }];
    deepStrictEqual(
      sortRows(list, name, 'asc').map((row) => row.n),
      [1, 2, null, undefined, Number.NaN],
    );
    deepStrictEqual(
      sortRows(list, name, 'desc').map((row) => row.n),
      [2, 1, null, undefined, Number.NaN],
    );
  });

  it('keeps the order of equal keys', () => {
    const list = [
      { n: 1, tag: 'a' },
      { n: 0, tag: 'b' },
      { n: 1, tag: 'c' },
      { n: 0, tag: 'd' },
    ];
    deepStrictEqual(
      sortRows(list, name, 'desc').map((row) => row.tag),
      ['a', 'c', 'b', 'd'],
    );
  });

  it('leaves the input untouched', () => {
    const list = [{ n: 2 }, { n: 1 }];
    sortRows(list, name, 'asc');
    deepStrictEqual(list, [{ n: 2 }, { n: 1 }]);
  });
});
