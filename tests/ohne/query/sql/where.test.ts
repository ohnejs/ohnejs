import { deepStrictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { useCollections } from '../../../../src/ohne/collections/use-collections.ts';
import { SQLiteDialect } from '../../../../src/ohne/database/dialects/sqlite/dialect.ts';
import { field } from '../../../../src/ohne/fields/field.ts';
import { queryMetadata } from '../../../../src/ohne/query/metadata.ts';
import { compileWhere } from '../../../../src/ohne/query/sql/where.ts';
import { parseCondition } from '../../../../src/utils/index.ts';

useCollections().register('WAuthors', {
  name: 'WAuthors',
  collection: { fields: { name: field('text') } },
});
useCollections().register('WTags', {
  name: 'WTags',
  collection: {
    fields: {
      label: field('text'),
      posts: field('records', { collection: 'WPosts', inverse: 'tags' }),
    },
  },
});
// A collection literally named `Sub`: a naive aliasing scheme would collide it with `_subN`; ours cannot.
useCollections().register('Sub', {
  name: 'Sub',
  collection: { fields: { name: field('text') } },
});
useCollections().register('WCat', {
  name: 'WCat',
  collection: { fields: { name: field('text'), parent: field('record', { collection: 'WCat' }) } },
});
useCollections().register('WPosts', {
  name: 'WPosts',
  collection: {
    fields: {
      title: field('text'),
      views: field('integer'),
      featured: field('boolean'),
      summary: field('text', { nullable: true }),
      author: field('record', { collection: 'WAuthors' }),
      ref: field('record', { collection: 'Sub' }),
      tags: field('records', { collection: 'WTags' }),
      meta: field('object', { fields: { note: field('text') } }),
      sections: field('repeater', {
        fields: {
          heading: field('text'),
          items: field('repeater', { fields: { label: field('text') } }),
        },
      }),
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

function compileOn(
  collection: string,
  condition: Record<string, unknown>,
): { sql: string; params: unknown[] } {
  const parsed = parseCondition(condition);
  if (!parsed.ok) throw new Error(`parse failed: ${parsed.error.code}`);
  return compileWhere(parsed.node, queryMetadata(collection), dialect);
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

  it('an empty `and` matches all, an empty `or` matches nothing', () => {
    deepStrictEqual(compile({ and: [] }), { sql: '1 = 1', params: [] });
    deepStrictEqual(compile({ or: [] }), { sql: '1 = 0', params: [] });
  });

  it('De Morgan folds `not` over a group into negated leaves at parse', () => {
    deepStrictEqual(compile({ not: { and: [{ featured: true }, { views: { atLeast: 100 } }] } }), {
      sql: '(NOT ("featured" = ?) OR NOT ("views" >= ?))',
      params: [1, 100],
    });
  });
});

describe('compileWhere relational', () => {
  it('a bare `record` has tests the foreign key, `empty` its null', () => {
    deepStrictEqual(compile({ author: { has: true } }), {
      sql: '"author" IS NOT NULL',
      params: [],
    });
    deepStrictEqual(compile({ author: { empty: true } }), { sql: '"author" IS NULL', params: [] });
  });

  it('a conditioned `record` has probes the target row through a correlated EXISTS', () => {
    deepStrictEqual(compile({ author: { has: { name: 'Ada' } } }), {
      sql: 'EXISTS (SELECT 1 FROM "WAuthors" "_sub0" WHERE "_sub0"."UUID" = "WPosts"."author" AND "_sub0"."name" = ?)',
      params: ['Ada'],
    });
  });

  it('a `records` has joins the target; a bare one and `empty` need only the junction', () => {
    deepStrictEqual(compile({ tags: { has: { label: 'red' } } }), {
      sql: 'EXISTS (SELECT 1 FROM "WPosts_tags" "_sub0" JOIN "WTags" "_sub1" ON "_sub1"."UUID" = "_sub0"."_targetUUID" WHERE "_sub0"."_parentUUID" = "WPosts"."UUID" AND "_sub1"."label" = ?)',
      params: ['red'],
    });
    deepStrictEqual(compile({ tags: { has: true } }), {
      sql: 'EXISTS (SELECT 1 FROM "WPosts_tags" "_sub0" WHERE "_sub0"."_parentUUID" = "WPosts"."UUID")',
      params: [],
    });
    deepStrictEqual(compile({ tags: { empty: true } }), {
      sql: 'NOT EXISTS (SELECT 1 FROM "WPosts_tags" "_sub0" WHERE "_sub0"."_parentUUID" = "WPosts"."UUID")',
      params: [],
    });
  });

  it('the inverse side swaps which junction column links the parent and the target', () => {
    deepStrictEqual(compileOn('WTags', { posts: { has: { title: 'First' } } }), {
      sql: 'EXISTS (SELECT 1 FROM "WPosts_tags" "_sub0" JOIN "WPosts" "_sub1" ON "_sub1"."UUID" = "_sub0"."_parentUUID" WHERE "_sub0"."_targetUUID" = "WTags"."UUID" AND "_sub1"."title" = ?)',
      params: ['First'],
    });
  });

  it('a child has correlates on `_parentUUID`; `empty` negates the same', () => {
    deepStrictEqual(compile({ meta: { has: { note: 'hi' } } }), {
      sql: 'EXISTS (SELECT 1 FROM "WPosts_meta" "_sub0" WHERE "_sub0"."_parentUUID" = "WPosts"."UUID" AND "_sub0"."note" = ?)',
      params: ['hi'],
    });
    deepStrictEqual(compile({ sections: { empty: true } }), {
      sql: 'NOT EXISTS (SELECT 1 FROM "WPosts_sections" "_sub0" WHERE "_sub0"."_parentUUID" = "WPosts"."UUID")',
      params: [],
    });
  });

  it('nested has recurses with fresh aliases', () => {
    deepStrictEqual(compile({ sections: { has: { items: { has: { label: 'i3' } } } } }), {
      sql: 'EXISTS (SELECT 1 FROM "WPosts_sections" "_sub0" WHERE "_sub0"."_parentUUID" = "WPosts"."UUID" AND EXISTS (SELECT 1 FROM "WPosts_sections_items" "_sub1" WHERE "_sub1"."_parentUUID" = "_sub0"."UUID" AND "_sub1"."label" = ?))',
      params: ['i3'],
    });
  });

  it('a self-referential relation gets a distinct alias at every depth', () => {
    deepStrictEqual(compileOn('WCat', { parent: { has: { parent: { has: { name: 'root' } } } } }), {
      sql: 'EXISTS (SELECT 1 FROM "WCat" "_sub0" WHERE "_sub0"."UUID" = "WCat"."parent" AND EXISTS (SELECT 1 FROM "WCat" "_sub1" WHERE "_sub1"."UUID" = "_sub0"."parent" AND "_sub1"."name" = ?))',
      params: ['root'],
    });
  });

  it('a collection named `Sub` never captures a `_subN` alias', () => {
    deepStrictEqual(compile({ ref: { has: { name: 'x' } } }), {
      sql: 'EXISTS (SELECT 1 FROM "Sub" "_sub0" WHERE "_sub0"."UUID" = "WPosts"."ref" AND "_sub0"."name" = ?)',
      params: ['x'],
    });
  });

  it('negation wraps the relational fragment, double-negating an `empty`', () => {
    deepStrictEqual(compile({ author: { not: { has: { name: 'Ada' } } } }), {
      sql: 'NOT (EXISTS (SELECT 1 FROM "WAuthors" "_sub0" WHERE "_sub0"."UUID" = "WPosts"."author" AND "_sub0"."name" = ?))',
      params: ['Ada'],
    });
    deepStrictEqual(compile({ tags: { not: { empty: true } } }), {
      sql: 'NOT (NOT EXISTS (SELECT 1 FROM "WPosts_tags" "_sub0" WHERE "_sub0"."_parentUUID" = "WPosts"."UUID"))',
      params: [],
    });
  });
});
