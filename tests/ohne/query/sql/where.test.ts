import { deepStrictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { useCollections } from '../../../../src/ohne/collections/use-collections.ts';
import { SQLiteDialect } from '../../../../src/ohne/database/dialects/sqlite/dialect.ts';
import { field } from '../../../../src/ohne/fields/field.ts';
import { queryMetadata } from '../../../../src/ohne/query/metadata.ts';
import { compileWhere } from '../../../../src/ohne/query/sql/where.ts';
import { parseCondition } from '../../../../src/utils/index.ts';

useCollections().register('WPosts', {
  name: 'WPosts',
  collection: {
    fields: {
      title: field('text'),
      views: field('integer'),
      featured: field('boolean'),
      summary: field('text', { nullable: true }),
    },
  },
});

const dialect = new SQLiteDialect();
const meta = queryMetadata('WPosts');

function compile(condition: Record<string, unknown>): { sql: string; params: unknown[] } {
  const parsed = parseCondition(condition);
  if (!parsed.ok) throw new Error(`parse failed: ${parsed.error.code}`);
  return compileWhere(parsed.node, meta, dialect);
}

describe('compileWhere', () => {
  it('equality binds the raw value, booleans through the codec', () => {
    deepStrictEqual(compile({ views: 100 }), { sql: '"views" = ?', params: [100] });
    deepStrictEqual(compile({ title: 'ohne' }), { sql: '"title" = ?', params: ['ohne'] });
    deepStrictEqual(compile({ featured: true }), { sql: '"featured" = ?', params: [1] });
  });

  it('`in` lists a placeholder per value; an empty list matches nothing', () => {
    deepStrictEqual(compile({ views: { in: [50, 100] } }), {
      sql: '"views" IN (?, ?)',
      params: [50, 100],
    });
    deepStrictEqual(compile({ views: { in: [] } }), { sql: '1 = 0', params: [] });
  });

  it('ordering compiles the four comparators', () => {
    deepStrictEqual(compile({ views: { greaterThan: 5 } }), { sql: '"views" > ?', params: [5] });
    deepStrictEqual(compile({ views: { atLeast: 5 } }), { sql: '"views" >= ?', params: [5] });
    deepStrictEqual(compile({ views: { lessThan: 5 } }), { sql: '"views" < ?', params: [5] });
    deepStrictEqual(compile({ views: { atMost: 5 } }), { sql: '"views" <= ?', params: [5] });
  });

  it('the text trio wraps an escaped pattern for the dialect match', () => {
    deepStrictEqual(compile({ title: { contains: 'oh' } }), {
      sql: `"title" LIKE ? ESCAPE '\\'`,
      params: ['%oh%'],
    });
    deepStrictEqual(compile({ title: { startsWith: 'oh' } }), {
      sql: `"title" LIKE ? ESCAPE '\\'`,
      params: ['oh%'],
    });
    deepStrictEqual(compile({ title: { endsWith: 'oh' } }), {
      sql: `"title" LIKE ? ESCAPE '\\'`,
      params: ['%oh'],
    });
    deepStrictEqual(compile({ title: { contains: '50%' } }), {
      sql: `"title" LIKE ? ESCAPE '\\'`,
      params: ['%50\\%%'],
    });
  });

  it('`like` binds its pattern raw, without escaping', () => {
    deepStrictEqual(compile({ title: { like: '%oh_' } }), {
      sql: '"title" LIKE ?',
      params: ['%oh_'],
    });
  });

  it('`isNull` binds no value', () => {
    deepStrictEqual(compile({ summary: { isNull: true } }), {
      sql: '"summary" IS NULL',
      params: [],
    });
  });

  it('negation wraps the positive fragment in `NOT (...)`', () => {
    deepStrictEqual(compile({ views: { not: { equalsTo: 100 } } }), {
      sql: 'NOT ("views" = ?)',
      params: [100],
    });
    deepStrictEqual(compile({ summary: { not: { isNull: true } } }), {
      sql: 'NOT ("summary" IS NULL)',
      params: [],
    });
  });

  it('a comparison `or` disjoins its own operators, parenthesized', () => {
    deepStrictEqual(compile({ views: { atLeast: 100, or: [{ equalsTo: 0 }] } }), {
      sql: '("views" >= ? OR "views" = ?)',
      params: [100, 0],
    });
  });

  it('sibling field keys AND, parenthesized', () => {
    deepStrictEqual(compile({ title: 'x', views: { atLeast: 5 } }), {
      sql: '("title" = ? AND "views" >= ?)',
      params: ['x', 5],
    });
  });

  it('two operators on one field AND as a range', () => {
    deepStrictEqual(compile({ views: { atLeast: 10, atMost: 20 } }), {
      sql: '("views" >= ? AND "views" <= ?)',
      params: [10, 20],
    });
  });
});
