import { deepStrictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { inFragment, joinFragments, rawFragment } from '../../../../src/ohne/query/sql/fragment.ts';

describe('rawFragment', () => {
  it('wraps SQL with its params', () => {
    deepStrictEqual(rawFragment('"a" = ?', [1]), { sql: '"a" = ?', params: [1] });
  });

  it('defaults params to an empty list', () => {
    deepStrictEqual(rawFragment('1 = 1'), { sql: '1 = 1', params: [] });
  });
});

describe('joinFragments', () => {
  it('joins SQL with the separator and concatenates params in order', () => {
    const joined = joinFragments(
      [rawFragment('"a" = ?', [1]), rawFragment('"b" IN (?, ?)', [2, 3]), rawFragment('1 = 1')],
      ' AND ',
    );
    deepStrictEqual(joined, { sql: '"a" = ? AND "b" IN (?, ?) AND 1 = 1', params: [1, 2, 3] });
  });

  it('passes a single fragment through unchanged', () => {
    deepStrictEqual(joinFragments([rawFragment('"a" = ?', [1])], ' OR '), {
      sql: '"a" = ?',
      params: [1],
    });
  });

  it('joins nothing into the empty fragment', () => {
    deepStrictEqual(joinFragments([], ' AND '), { sql: '', params: [] });
  });
});

describe('inFragment', () => {
  it('builds one placeholder per value', () => {
    deepStrictEqual(inFragment('"status"', ['draft', 'published']), {
      sql: '"status" IN (?, ?)',
      params: ['draft', 'published'],
    });
  });

  it('compiles an empty list to match nothing', () => {
    deepStrictEqual(inFragment('"status"', []), { sql: '1 = 0', params: [] });
  });
});
