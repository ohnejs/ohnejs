import { deepStrictEqual, strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import {
  parseTableState,
  resolveTableColumns,
  serializeTableState,
  sortFromOrder,
  stripEditParam,
  type TableFieldMeta,
  type TableURLState,
} from '../../../../src/layer/dashboard/components/collection-table-state.ts';

const DEFAULT_ORDER = ['-_updatedAt'];

function field(name: string, overrides: Partial<TableFieldMeta> = {}): TableFieldMeta {
  return { name, label: name, kind: 'column', logicalType: 'text', readable: true, ...overrides };
}

const FIELDS: TableFieldMeta[] = [
  field('UUID'),
  field('_updatedAt', { logicalType: 'integer' }),
  field('title'),
  field('views', { logicalType: 'integer' }),
  field('published', { logicalType: 'boolean' }),
  field('author', { kind: 'record' }),
  field('sections', { kind: 'childMany', logicalType: undefined }),
];

describe('parseTableState', () => {
  it('reads defaults from an empty search', () => {
    deepStrictEqual(parseTableState('', DEFAULT_ORDER), {
      page: 1,
      order: ['-_updatedAt'],
      where: undefined,
      columns: undefined,
    });
  });

  it('reads page, order, where, and columns', () => {
    const state = parseTableState(
      `?page=3&order=-title,views&where=${encodeURIComponent('{"views":{"atLeast":2}}')}&columns=title|20rem`,
      DEFAULT_ORDER,
    );
    deepStrictEqual(state, {
      page: 3,
      order: ['-title', 'views'],
      where: { views: { atLeast: 2 } },
      columns: 'title|20rem',
    });
  });

  it('falls back on an invalid page', () => {
    strictEqual(parseTableState('?page=0', DEFAULT_ORDER).page, 1);
    strictEqual(parseTableState('?page=2.5', DEFAULT_ORDER).page, 1);
    strictEqual(parseTableState('?page=abc', DEFAULT_ORDER).page, 1);
  });

  it('falls back on an empty order', () => {
    deepStrictEqual(parseTableState('?order=,', DEFAULT_ORDER).order, ['-_updatedAt']);
  });

  it('reads a malformed or non-object where as no filter', () => {
    strictEqual(parseTableState('?where={oops', DEFAULT_ORDER).where, undefined);
    strictEqual(parseTableState('?where=42', DEFAULT_ORDER).where, undefined);
  });
});

describe('serializeTableState', () => {
  it('omits every default', () => {
    const state: TableURLState = {
      page: 1,
      order: ['-_updatedAt'],
      where: undefined,
      columns: undefined,
    };
    strictEqual(serializeTableState(state, DEFAULT_ORDER), '');
  });

  it('round-trips through parseTableState', () => {
    const state: TableURLState = {
      page: 4,
      order: ['title', '-views'],
      where: { published: { equalsTo: true } },
      columns: 'title|20rem,views',
    };
    const query = serializeTableState(state, DEFAULT_ORDER);
    deepStrictEqual(parseTableState(`?${query}`, DEFAULT_ORDER), state);
  });

  it('keeps foreign params and replaces its own', () => {
    const state: TableURLState = {
      page: 2,
      order: ['title'],
      where: undefined,
      columns: undefined,
    };
    const query = serializeTableState(state, DEFAULT_ORDER, '?edit=title:abc&page=9&order=-views');
    strictEqual(query, 'edit=title%3Aabc&page=2&order=title');
  });
});

describe('sortFromOrder', () => {
  it('splits the first entry into column and direction', () => {
    deepStrictEqual(sortFromOrder(['-title', 'views']), { column: 'title', direction: 'desc' });
    deepStrictEqual(sortFromOrder(['views']), { column: 'views', direction: 'asc' });
  });

  it('reads no sort from an empty list', () => {
    strictEqual(sortFromOrder([]), null);
    strictEqual(sortFromOrder(['-']), null);
  });
});

describe('stripEditParam', () => {
  it('removes only the edit param', () => {
    strictEqual(stripEditParam('?page=2&edit=title:abc'), '?page=2');
    strictEqual(stripEditParam('?edit=title:abc'), '');
    strictEqual(stripEditParam(''), '');
  });
});

describe('resolveTableColumns', () => {
  it('defaults to the first four declared fields plus _updatedAt', () => {
    deepStrictEqual(
      resolveTableColumns(FIELDS).map((column) => column.name),
      ['title', 'views', 'published', 'author', '_updatedAt'],
    );
  });

  it('assigns sortability and the 16rem minimum by default', () => {
    const columns = resolveTableColumns(FIELDS);
    deepStrictEqual(columns[0], {
      name: 'title',
      label: 'title',
      sortable: 'text',
      minWidth: '16rem',
    });
    strictEqual(columns[1]?.sortable, 'numeric');
    strictEqual(columns[4]?.sortable, 'numeric');
  });

  it('does not sort composite kinds', () => {
    const columns = resolveTableColumns(FIELDS, 'sections');
    strictEqual(columns[0]?.sortable, false);
  });

  it('skips write-only fields in the default set', () => {
    const columns = resolveTableColumns([
      field('UUID'),
      field('_updatedAt', { logicalType: 'integer' }),
      field('secret', { readable: false }),
      field('title'),
    ]);
    deepStrictEqual(
      columns.map((column) => column.name),
      ['title', '_updatedAt'],
    );
  });

  it('resolves a columns spec with widths', () => {
    const columns = resolveTableColumns(FIELDS, 'title|20rem,views,published|50%|10rem');
    deepStrictEqual(columns, [
      { name: 'title', label: 'title', sortable: 'text', width: '20rem' },
      { name: 'views', label: 'views', sortable: 'numeric', minWidth: '16rem' },
      {
        name: 'published',
        label: 'published',
        sortable: 'numeric',
        width: '50%',
        minWidth: '10rem',
      },
    ]);
  });

  it('skips unknown fields in a spec', () => {
    deepStrictEqual(
      resolveTableColumns(FIELDS, 'title,ghost').map((column) => column.name),
      ['title'],
    );
  });

  it('falls back to the UUID column when nothing resolves', () => {
    deepStrictEqual(resolveTableColumns(FIELDS, 'ghost'), [
      { name: 'UUID', label: 'UUID', sortable: 'text' },
    ]);
  });
});
