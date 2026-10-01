import { deepStrictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import type { FieldQueryMeta } from '../../../src/ohne/query/metadata.ts';
import type { QueryOperator } from '../../../src/ohne/query/operators.ts';

import { allowedOperators } from '../../../src/ohne/query/operators.ts';

const ORDERING: QueryOperator[] = ['greaterThan', 'atLeast', 'lessThan', 'atMost'];
const TEXT: QueryOperator[] = ['contains', 'startsWith', 'endsWith', 'like'];

const table: [name: string, meta: FieldQueryMeta, expected: QueryOperator[]][] = [
  [
    'UUID entry takes identity tests alone',
    { kind: 'column', nullable: false, logicalType: 'text', column: 'UUID', id: true },
    ['equalsTo', 'in'],
  ],
  [
    'text column takes equality, ordering, and the text operators',
    { kind: 'column', nullable: false, logicalType: 'text', column: 'title' },
    ['equalsTo', 'in', ...ORDERING, ...TEXT],
  ],
  [
    'nullable text column adds isNull',
    { kind: 'column', nullable: true, logicalType: 'text', column: 'summary' },
    ['equalsTo', 'in', ...ORDERING, ...TEXT, 'isNull'],
  ],
  [
    'non-nullable companion text column adds isNull, a missing translation reading null',
    { kind: 'column', nullable: false, logicalType: 'text', column: 'title', companion: true },
    ['equalsTo', 'in', ...ORDERING, ...TEXT, 'isNull'],
  ],
  [
    'integer column takes equality and ordering, never the text operators',
    { kind: 'column', nullable: false, logicalType: 'integer', column: 'views' },
    ['equalsTo', 'in', ...ORDERING],
  ],
  [
    'real column takes equality and ordering, never the text operators',
    { kind: 'column', nullable: false, logicalType: 'real', column: 'rating' },
    ['equalsTo', 'in', ...ORDERING],
  ],
  [
    'boolean column takes equalsTo alone',
    { kind: 'column', nullable: false, logicalType: 'boolean', column: 'featured' },
    ['equalsTo'],
  ],
  [
    'nullable boolean column adds isNull',
    { kind: 'column', nullable: true, logicalType: 'boolean', column: 'featured' },
    ['equalsTo', 'isNull'],
  ],
  [
    'plain json column takes nothing',
    { kind: 'column', nullable: false, logicalType: 'json', column: 'data' },
    [],
  ],
  [
    'nullable json column takes isNull alone',
    { kind: 'column', nullable: true, logicalType: 'json', column: 'data' },
    ['isNull'],
  ],
  [
    'json list column takes the includes group',
    { kind: 'column', nullable: false, logicalType: 'json', column: 'labels', jsonList: true },
    ['includes', 'includesAll', 'includesAny'],
  ],
  [
    'record takes identity, isNull, and the relation pair - never text or ordering',
    { kind: 'record', nullable: true, logicalType: 'text', column: 'author', target: 'Users' },
    ['equalsTo', 'in', 'isNull', 'has', 'empty'],
  ],
  [
    'non-nullable record drops isNull',
    { kind: 'record', nullable: false, logicalType: 'text', column: 'author', target: 'Users' },
    ['equalsTo', 'in', 'has', 'empty'],
  ],
  [
    'non-nullable companion record adds isNull',
    {
      kind: 'record',
      nullable: false,
      logicalType: 'text',
      column: 'author',
      target: 'Users',
      companion: true,
    },
    ['equalsTo', 'in', 'isNull', 'has', 'empty'],
  ],
  [
    'records takes target membership and the relation pair',
    { kind: 'records', nullable: false, target: 'Tags', table: 'Posts_tags' },
    ['includes', 'includesAny', 'has', 'empty'],
  ],
  [
    'childOne takes the relation pair, nothing null-related',
    { kind: 'childOne', nullable: true, table: 'Posts_meta', subfields: {} },
    ['has', 'empty'],
  ],
  [
    'childMany takes the relation pair alone',
    { kind: 'childMany', nullable: false, table: 'Posts_sections', subfields: {} },
    ['has', 'empty'],
  ],
];

describe('allowedOperators', () => {
  for (const [name, meta, expected] of table) {
    it(name, () => {
      deepStrictEqual([...allowedOperators(meta)].sort(), [...expected].sort());
    });
  }
});

describe('allowedOperators on the translations entry', () => {
  const entry: FieldQueryMeta = {
    kind: 'translations',
    nullable: false,
    tables: ['Posts__translations'],
  };

  it('admits list membership alone', () => {
    deepStrictEqual([...allowedOperators(entry)].sort(), [
      'includes',
      'includesAll',
      'includesAny',
    ]);
  });

  it('admits nothing once a scope marks it narrowed', () => {
    deepStrictEqual([...allowedOperators({ ...entry, narrowed: true })], []);
  });
});
