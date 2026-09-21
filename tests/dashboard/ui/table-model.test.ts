import { deepStrictEqual, notStrictEqual, strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import {
  rangeSelect,
  tableColumn,
  toggleSort,
  type TableRow,
} from '../../../src/dashboard/ui/table-model.ts';

const columns = {
  id: tableColumn<number>({ label: 'ID', width: '4rem' }),
  name: tableColumn<string>({ label: 'Name', minWidth: '8rem', sortable: 'text' }),
};

type Columns = typeof columns;

function rows(...ids: number[]): TableRow<Columns>[] {
  return ids.map((id) => ({ id }));
}

describe('tableColumn', () => {
  it('is an identity cast', () => {
    const definition = { label: 'ID', width: '4rem' };
    strictEqual(tableColumn<number>(definition), definition);
  });
});

describe('toggleSort', () => {
  it('starts ascending from no sort', () => {
    deepStrictEqual(toggleSort<Columns>(null, 'name'), { column: 'name', direction: 'asc' });
  });

  it('flips the direction on the same column', () => {
    deepStrictEqual(toggleSort<Columns>({ column: 'name', direction: 'asc' }, 'name'), {
      column: 'name',
      direction: 'desc',
    });
    deepStrictEqual(toggleSort<Columns>({ column: 'name', direction: 'desc' }, 'name'), {
      column: 'name',
      direction: 'asc',
    });
  });

  it('starts ascending on a different column', () => {
    deepStrictEqual(toggleSort<Columns>({ column: 'name', direction: 'desc' }, 'id'), {
      column: 'id',
      direction: 'asc',
    });
  });
});

describe('rangeSelect', () => {
  it('selects the inclusive range from the anchor down', () => {
    deepStrictEqual(rangeSelect(rows(1, 2, 3, 4), {}, 1, 3, true), { 1: true, 2: true, 3: true });
  });

  it('selects the inclusive range from the anchor up', () => {
    deepStrictEqual(rangeSelect(rows(1, 2, 3, 4), {}, 4, 2, true), { 2: true, 3: true, 4: true });
  });

  it('keeps the anchor selected when deselecting a range', () => {
    deepStrictEqual(rangeSelect(rows(1, 2, 3), { 1: true, 2: true, 3: true }, 1, 3, false), {
      1: true,
      2: false,
      3: false,
    });
  });

  it('preserves selections outside the range', () => {
    deepStrictEqual(rangeSelect(rows(1, 2, 3, 4), { 4: true }, 1, 2, true), {
      1: true,
      2: true,
      4: true,
    });
  });

  it('skips the rows the predicate refuses', () => {
    const selectable = (row: TableRow<Columns>): boolean => row.id !== 2;
    deepStrictEqual(rangeSelect(rows(1, 2, 3), {}, 1, 3, true, selectable), { 1: true, 3: true });
    deepStrictEqual(rangeSelect(rows(1, 2, 3), { 2: true, 3: true }, 1, 3, false, selectable), {
      1: true,
      2: true,
      3: false,
    });
  });

  it('never selects an anchor the predicate refuses', () => {
    deepStrictEqual(
      rangeSelect(rows(1, 2, 3), {}, 1, 3, true, (row) => row.id !== 1),
      { 2: true, 3: true },
    );
  });

  it('returns a fresh object', () => {
    const selected = { 1: true };
    notStrictEqual(rangeSelect(rows(1, 2), selected, 1, 2, true), selected);
    deepStrictEqual(selected, { 1: true });
  });
});
