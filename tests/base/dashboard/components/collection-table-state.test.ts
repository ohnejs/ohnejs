import { deepStrictEqual, strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import {
  editableTableColumns,
  healView,
  parseTableState,
  resolveTableColumns,
  serializeTableColumnEdits,
  serializeTableColumns,
  serializeTableState,
  sortableFieldsOf,
  sortableOf,
  sortFromOrder,
  stripEditParam,
  type TableFieldMeta,
  type TableURLState,
} from '../../../../src/base/dashboard/components/collection-table-state.ts';

const DEFAULT_ORDER = ['-_updatedAt'];

function warnings(warn: { mock: { calls: { arguments: unknown[] }[] } }): unknown[] {
  return warn.mock.calls.map((call) => call.arguments[0]);
}

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

const TRANSLATABLE: TableFieldMeta[] = [
  field('UUID'),
  field('_updatedAt', { logicalType: 'integer' }),
  field('_translations', { kind: 'translations', logicalType: undefined }),
  ...FIELDS.slice(2),
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
      '?page=3&order=[-title,views]&where={views:{atLeast:2}}&columns=[title|20rem]',
      DEFAULT_ORDER,
    );
    deepStrictEqual(state, {
      page: 3,
      order: ['-title', 'views'],
      where: { views: { atLeast: 2 } },
      columns: ['title|20rem'],
    });
  });

  it('falls back on an invalid page', () => {
    strictEqual(parseTableState('?page=0', DEFAULT_ORDER).page, 1);
    strictEqual(parseTableState('?page=2.5', DEFAULT_ORDER).page, 1);
    strictEqual(parseTableState('?page=abc', DEFAULT_ORDER).page, 1);
  });

  it('falls back on an empty order', () => {
    deepStrictEqual(parseTableState('?order=[]', DEFAULT_ORDER).order, ['-_updatedAt']);
    deepStrictEqual(parseTableState('?order=', DEFAULT_ORDER).order, ['-_updatedAt']);
  });

  it('reads a lone order entry as a one-entry list', () => {
    deepStrictEqual(parseTableState('?order=-title', DEFAULT_ORDER).order, ['-title']);
    deepStrictEqual(parseTableState('?order=[-title]', DEFAULT_ORDER).order, ['-title']);
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
      columns: ['title|20rem', 'views'],
    };
    const query = serializeTableState(state, DEFAULT_ORDER);
    strictEqual(
      query,
      'page=4&order=[title,-views]&where={published:{equalsTo:true}}&columns=[title|20rem,views]',
    );
    deepStrictEqual(parseTableState(`?${query}`, DEFAULT_ORDER), state);
  });

  it('keeps foreign params and replaces its own', () => {
    const state: TableURLState = {
      page: 2,
      order: ['title'],
      where: undefined,
      columns: undefined,
    };
    const query = serializeTableState(
      state,
      DEFAULT_ORDER,
      '?edit=[title,abc]&page=9&order=[-views]',
    );
    strictEqual(query, 'edit=[title,abc]&page=2&order=[title]');
  });
});

describe('healView', () => {
  const state: TableURLState = {
    page: 2,
    order: ['title'],
    where: { views: { atLeast: 'x' } },
    columns: ['title', 'views'],
  };
  const bare: TableURLState = {
    page: 2,
    order: [...DEFAULT_ORDER],
    where: undefined,
    columns: undefined,
  };

  it('drops the filter for a path inside `where`, and for a bare `where`', () => {
    deepStrictEqual(healView(state, 'where.views.atLeast', DEFAULT_ORDER), { where: undefined });
    deepStrictEqual(healView(state, 'where', DEFAULT_ORDER), { where: undefined });
  });

  it('restores the default order for a path inside `order`', () => {
    deepStrictEqual(healView(state, 'order[0]', DEFAULT_ORDER), { order: DEFAULT_ORDER });
    deepStrictEqual(healView(state, 'order', DEFAULT_ORDER), { order: DEFAULT_ORDER });
  });

  it('restores the declared columns for a path inside `select`', () => {
    deepStrictEqual(healView(state, 'select[1]', DEFAULT_ORDER), { columns: undefined });
    deepStrictEqual(healView(state, 'select', DEFAULT_ORDER), { columns: undefined });
  });

  it('drops nothing when the state does not carry the refused part', () => {
    strictEqual(healView(bare, 'where.views', DEFAULT_ORDER), undefined);
    strictEqual(healView(bare, 'order[0]', DEFAULT_ORDER), undefined);
    strictEqual(healView(bare, 'select[1]', DEFAULT_ORDER), undefined);
    strictEqual(healView({ ...bare, columns: [] }, 'select[1]', DEFAULT_ORDER), undefined);
  });

  it('drops nothing for a path outside the view', () => {
    strictEqual(healView(state, '', DEFAULT_ORDER), undefined);
    strictEqual(healView(state, 'locale', DEFAULT_ORDER), undefined);
    strictEqual(healView(state, 'perPage', DEFAULT_ORDER), undefined);
    strictEqual(healView(state, 'whereabouts', DEFAULT_ORDER), undefined);
  });

  it('copies the default order, so the patch never aliases it', () => {
    const patch = healView(state, 'order[0]', DEFAULT_ORDER);
    patch?.order?.push('views');
    deepStrictEqual(DEFAULT_ORDER, ['-_updatedAt']);
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
    strictEqual(stripEditParam('?page=2&edit=[title,abc]'), '?page=2');
    strictEqual(stripEditParam('?edit=[title,abc]'), '');
    strictEqual(stripEditParam(''), '');
  });

  it('leaves a readable filter untouched', () => {
    strictEqual(
      stripEditParam('?where={email:{contains:@}}&edit=[title,abc]'),
      '?where={email:{contains:@}}',
    );
  });
});

describe('sortableFieldsOf', () => {
  it('offers a record field, which the wire orders by its stored reference', () => {
    const author = field('author', { kind: 'record' });
    deepStrictEqual(sortableFieldsOf([author]), [author]);
  });

  it('leaves out json columns, composites, and unreadable fields', () => {
    const title = field('title');
    const fields = [
      title,
      field('data', { logicalType: 'json' }),
      field('tags', { kind: 'childMany' }),
      field('secret', { readable: false }),
    ];
    deepStrictEqual(sortableFieldsOf(fields), [title]);
  });

  it('offers a one-child composite through its readable sort part, typed by that part', () => {
    const parts = [
      field('start', { logicalType: 'integer' }),
      field('label'),
      field('note', { readable: false }),
    ];
    const composite = (orderBy?: string) =>
      field('period', { kind: 'childOne', logicalType: undefined, orderBy, subfields: parts });
    deepStrictEqual(sortableFieldsOf([composite('start'), composite(), composite('note')]), [
      composite('start'),
    ]);
    strictEqual(sortableOf(composite('start')), 'numeric');
    strictEqual(sortableOf(composite('label')), 'text');
  });
});

describe('resolveTableColumns', () => {
  it('defaults to the first four declared fields plus _updatedAt', () => {
    deepStrictEqual(
      resolveTableColumns(FIELDS).map((column) => column.name),
      ['title', 'views', 'published', 'author', '_updatedAt'],
    );
  });

  it('assigns sortability and the 256px minimum by default', () => {
    const columns = resolveTableColumns(FIELDS);
    deepStrictEqual(columns[0], {
      name: 'title',
      label: 'title',
      sortable: 'text',
      minWidth: '256px',
    });
    strictEqual(columns[1]?.sortable, 'numeric');
    strictEqual(columns[4]?.sortable, 'numeric');
  });

  it('does not sort composite kinds', () => {
    const columns = resolveTableColumns(FIELDS, ['sections']);
    strictEqual(columns[0]?.sortable, false);
  });

  it('gives a translatable collection three declared fields, then _translations, then _updatedAt', () => {
    deepStrictEqual(
      resolveTableColumns(TRANSLATABLE).map((column) => column.name),
      ['title', 'views', 'published', '_translations', '_updatedAt'],
    );
    deepStrictEqual(resolveTableColumns(TRANSLATABLE)[3], {
      name: '_translations',
      label: '_translations',
      sortable: false,
      minWidth: '256px',
    });
  });

  it('resolves _translations from a spec entry, unsortable', () => {
    const columns = resolveTableColumns(TRANSLATABLE, ['_translations|120px', 'title']);
    deepStrictEqual(
      columns.map((column) => [column.name, column.sortable, column.width]),
      [
        ['_translations', false, '120px'],
        ['title', 'text', undefined],
      ],
    );
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
    const columns = resolveTableColumns(FIELDS, ['title|20rem', 'views', 'published|50%|10rem']);
    deepStrictEqual(columns, [
      { name: 'title', label: 'title', sortable: 'text', width: '20rem' },
      { name: 'views', label: 'views', sortable: 'numeric', minWidth: '256px' },
      {
        name: 'published',
        label: 'published',
        sortable: 'numeric',
        width: '50%',
        minWidth: '10rem',
      },
    ]);
  });

  it('skips unknown fields in a spec, and warns', (t) => {
    const warn = t.mock.method(console, 'warn', () => {});
    deepStrictEqual(
      resolveTableColumns(FIELDS, ['title', 'ghost']).map((column) => column.name),
      ['title'],
    );
    deepStrictEqual(warnings(warn), [
      'Unable to resolve field `ghost` in the collection table columns.',
    ]);
  });

  it('falls back to the UUID column when nothing resolves', (t) => {
    t.mock.method(console, 'warn', () => {});
    deepStrictEqual(resolveTableColumns(FIELDS, ['ghost']), [
      { name: 'UUID', label: 'UUID', sortable: 'text' },
    ]);
  });

  it('skips an unreadable field named in a spec, and warns', (t) => {
    const warn = t.mock.method(console, 'warn', () => {});
    const fields = [...FIELDS, field('secret', { readable: false })];
    deepStrictEqual(
      resolveTableColumns(fields, ['title', 'secret']).map((column) => column.name),
      ['title'],
    );
    deepStrictEqual(warnings(warn), [
      'Field `secret` is not readable and cannot be a collection table column.',
    ]);
  });

  it('keeps the first of two entries naming the same field, and warns', (t) => {
    const warn = t.mock.method(console, 'warn', () => {});
    deepStrictEqual(resolveTableColumns(FIELDS, ['title|20rem', 'title']), [
      { name: 'title', label: 'title', sortable: 'text', width: '20rem' },
    ]);
    deepStrictEqual(warnings(warn), ['Field `title` is repeated in the collection table columns.']);
  });

  it('drops a width slot that is not a plain CSS length, and warns', (t) => {
    const warn = t.mock.method(console, 'warn', () => {});
    deepStrictEqual(resolveTableColumns(FIELDS, ['title|1px;background:url(//evil.example/x)']), [
      { name: 'title', label: 'title', sortable: 'text', minWidth: '256px' },
    ]);
    deepStrictEqual(resolveTableColumns(FIELDS, ['title|20rem|calc(100%)']), [
      { name: 'title', label: 'title', sortable: 'text', width: '20rem' },
    ]);
    deepStrictEqual(warnings(warn), [
      'Ignoring invalid width `1px;background:url(//evil.example/x)` in the collection table columns.',
      'Ignoring invalid width `calc(100%)` in the collection table columns.',
    ]);
  });
});

describe('serializeTableColumns', () => {
  it('serializes each entry shape', () => {
    deepStrictEqual(
      serializeTableColumns([
        { name: 'title', label: 'title', sortable: 'text', minWidth: '256px' },
        { name: 'title', label: 'title', sortable: 'text', width: '256px' },
        { name: 'title', label: 'title', sortable: 'text', minWidth: '24rem' },
        { name: 'title', label: 'title', sortable: 'text', width: '50%', minWidth: '24rem' },
      ]),
      ['title', 'title|256px', 'title||24rem', 'title|50%|24rem'],
    );
  });

  it('round-trips through resolveTableColumns', () => {
    const specs = [
      ['title'],
      ['title|256px'],
      ['title|256px|24rem'],
      ['title||24rem'],
      ['title|50%|24rem'],
    ];
    for (const spec of specs) {
      deepStrictEqual(serializeTableColumns(resolveTableColumns(FIELDS, spec)), spec);
    }
  });

  it('serializes the auto default to bare entries', () => {
    deepStrictEqual(serializeTableColumns(resolveTableColumns(FIELDS)), [
      'title',
      'views',
      'published',
      'author',
      '_updatedAt',
    ]);
  });
});

describe('editableTableColumns', () => {
  it('decodes widths: absent to auto, a pixel count to its number, anything else preserved', () => {
    deepStrictEqual(editableTableColumns(['title'], FIELDS), [
      { $key: 'title', name: 'title', width: null },
    ]);
    deepStrictEqual(editableTableColumns(['title|256px'], FIELDS), [
      { $key: 'title', name: 'title', width: 256, rawWidth: '256px' },
    ]);
    deepStrictEqual(editableTableColumns(['title|20rem'], FIELDS), [
      { $key: 'title', name: 'title', width: false, rawWidth: '20rem' },
    ]);
  });

  it('rejects a zero-padded pixel width', () => {
    strictEqual(editableTableColumns(['title|01px'], FIELDS)[0]?.width, false);
  });

  it('preserves a pixel width beside a minimum, so the pair survives a round trip', () => {
    deepStrictEqual(editableTableColumns(['title|256px|24rem'], FIELDS), [
      { $key: 'title', name: 'title', width: false, rawWidth: '256px', rawMinWidth: '24rem' },
    ]);
  });

  it('keeps the minWidth slot as written', () => {
    deepStrictEqual(editableTableColumns(['title|50%|24rem'], FIELDS), [
      { $key: 'title', name: 'title', width: false, rawWidth: '50%', rawMinWidth: '24rem' },
    ]);
  });

  it('drops unknown, unreadable, and repeated names', (t) => {
    const warn = t.mock.method(console, 'warn', () => {});
    const fields = [...FIELDS, field('secret', { readable: false })];
    deepStrictEqual(
      editableTableColumns(['ghost', 'secret', 'title', 'title'], fields).map((item) => item.name),
      ['title'],
    );
    strictEqual(warnings(warn).length, 3);
  });
});

describe('serializeTableColumnEdits', () => {
  it('inverts editableTableColumns for each entry shape', () => {
    const specs = [
      ['title'],
      ['title|256px'],
      ['title|256px|24rem'],
      ['title|20rem'],
      ['title||24rem'],
      ['title|50%|24rem'],
    ];
    for (const spec of specs) {
      deepStrictEqual(serializeTableColumnEdits(editableTableColumns(spec, FIELDS)), spec);
    }
  });

  it('drops the minimum from a fixed width', () => {
    deepStrictEqual(
      serializeTableColumnEdits([
        { $key: 'title', name: 'title', width: 300, rawMinWidth: '24rem' },
      ]),
      ['title|300px'],
    );
  });
});
