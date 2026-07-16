import { deepStrictEqual, ok, strictEqual } from 'node:assert';
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

useCollections().register('WLBooks', {
  name: 'WLBooks',
  collection: {
    fields: { title: field('text', { translatable: true }), isbn: field('text') },
  },
});
useCollections().register('WLTags', {
  name: 'WLTags',
  collection: {
    fields: {
      label: field('text', { translatable: true }),
      slug: field('text'),
      posts: field('records', { collection: 'WLPosts', inverse: 'tags' }),
    },
  },
});
useCollections().register('WLPosts', {
  name: 'WLPosts',
  collection: {
    fields: {
      title: field('text', { translatable: true }),
      author: field('record', { collection: 'WAuthors', translatable: true }),
      book: field('record', { collection: 'WLBooks' }),
      tags: field('records', { collection: 'WLTags', translatable: true }),
      sections: field('repeater', {
        translatable: true,
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
  return compileWhere(parsed.node, meta, dialect, 'en');
}

function compileOn(
  collection: string,
  condition: Record<string, unknown>,
): { sql: string; params: unknown[] } {
  const parsed = parseCondition(condition);
  if (!parsed.ok) throw new Error(`parse failed: ${parsed.error.code}`);
  return compileWhere(parsed.node, queryMetadata(collection), dialect, 'en');
}

function compileTranslatable(
  condition: Record<string, unknown>,
  locale = 'en',
): { sql: string; params: unknown[] } {
  const parsed = parseCondition(condition);
  if (!parsed.ok) throw new Error(`parse failed: ${parsed.error.code}`);
  return compileWhere(parsed.node, queryMetadata('WLPosts'), dialect, locale);
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

describe('compileWhere companion columns', () => {
  it('a top-level compare on a companion column reads it bare', () => {
    deepStrictEqual(compileTranslatable({ title: 'Hallo' }), {
      sql: '"title" = ?',
      params: ['Hallo'],
    });
    deepStrictEqual(compileTranslatable({ title: { isNull: true } }), {
      sql: '"title" IS NULL',
      params: [],
    });
  });

  it('a bare companion `record` has tests the bare foreign key, `empty` its null', () => {
    deepStrictEqual(compileTranslatable({ author: { has: true } }), {
      sql: '"author" IS NOT NULL',
      params: [],
    });
    deepStrictEqual(compileTranslatable({ author: { empty: true } }), {
      sql: '"author" IS NULL',
      params: [],
    });
  });

  it('a conditioned companion `record` has correlates the foreign key through the companion', () => {
    deepStrictEqual(compileTranslatable({ author: { has: { name: 'Ada' } } }), {
      sql: 'EXISTS (SELECT 1 FROM "WAuthors" "_sub0" WHERE "_sub0"."UUID" = "WLPosts__translations"."author" AND "_sub0"."name" = ?)',
      params: ['Ada'],
    });
  });

  it('an `EXISTS` into a translatable target joins its companion at the locale, bound first', () => {
    deepStrictEqual(compileTranslatable({ book: { has: { title: 'Krieg' } } }), {
      sql: 'EXISTS (SELECT 1 FROM "WLBooks" "_sub0" LEFT JOIN "WLBooks__translations" "_sub1" ON "_sub1"."_parentUUID" = "_sub0"."UUID" AND "_sub1"."_localeCode" = ? WHERE "_sub0"."UUID" = "WLPosts"."book" AND "_sub1"."title" = ?)',
      params: ['en', 'Krieg'],
    });
  });

  it('a nested condition off the companion fields joins no companion', () => {
    const fragment = compileTranslatable({ book: { has: { isbn: '123' } } });
    deepStrictEqual(fragment, {
      sql: 'EXISTS (SELECT 1 FROM "WLBooks" "_sub0" WHERE "_sub0"."UUID" = "WLPosts"."book" AND "_sub0"."isbn" = ?)',
      params: ['123'],
    });
    ok(!fragment.sql.includes('__translations'));
  });
});

describe('compileWhere locale-scoped tables', () => {
  it('a locale-scoped junction binds the locale in bare and `empty` correlations', () => {
    deepStrictEqual(compileTranslatable({ tags: { has: true } }), {
      sql: 'EXISTS (SELECT 1 FROM "WLPosts_tags" "_sub0" WHERE "_sub0"."_parentUUID" = "WLPosts"."UUID" AND "_sub0"."_localeCode" = ?)',
      params: ['en'],
    });
    deepStrictEqual(compileTranslatable({ tags: { empty: true } }), {
      sql: 'NOT EXISTS (SELECT 1 FROM "WLPosts_tags" "_sub0" WHERE "_sub0"."_parentUUID" = "WLPosts"."UUID" AND "_sub0"."_localeCode" = ?)',
      params: ['en'],
    });
  });

  it('a conditioned locale-scoped junction joins the target, the locale still bound', () => {
    const fragment = compileTranslatable({ tags: { has: { slug: 'news' } } });
    deepStrictEqual(fragment, {
      sql: 'EXISTS (SELECT 1 FROM "WLPosts_tags" "_sub0" JOIN "WLTags" "_sub1" ON "_sub1"."UUID" = "_sub0"."_targetUUID" WHERE "_sub0"."_parentUUID" = "WLPosts"."UUID" AND "_sub0"."_localeCode" = ? AND "_sub1"."slug" = ?)',
      params: ['en', 'news'],
    });
    ok(!fragment.sql.includes('__translations'));
  });

  it('a translatable junction target composes the companion join with a fresh alias', () => {
    deepStrictEqual(compileTranslatable({ tags: { has: { label: 'rot' } } }), {
      sql: 'EXISTS (SELECT 1 FROM "WLPosts_tags" "_sub0" JOIN "WLTags" "_sub1" ON "_sub1"."UUID" = "_sub0"."_targetUUID" LEFT JOIN "WLTags__translations" "_sub2" ON "_sub2"."_parentUUID" = "_sub1"."UUID" AND "_sub2"."_localeCode" = ? WHERE "_sub0"."_parentUUID" = "WLPosts"."UUID" AND "_sub0"."_localeCode" = ? AND "_sub2"."label" = ?)',
      params: ['en', 'en', 'rot'],
    });
  });

  it('the inverse side of a locale-scoped junction binds the querying locale', () => {
    deepStrictEqual(compileOn('WLTags', { posts: { has: true } }), {
      sql: 'EXISTS (SELECT 1 FROM "WLPosts_tags" "_sub0" WHERE "_sub0"."_targetUUID" = "WLTags"."UUID" AND "_sub0"."_localeCode" = ?)',
      params: ['en'],
    });
    deepStrictEqual(compileOn('WLTags', { posts: { has: { title: 'Hallo' } } }), {
      sql: 'EXISTS (SELECT 1 FROM "WLPosts_tags" "_sub0" JOIN "WLPosts" "_sub1" ON "_sub1"."UUID" = "_sub0"."_parentUUID" LEFT JOIN "WLPosts__translations" "_sub2" ON "_sub2"."_parentUUID" = "_sub1"."UUID" AND "_sub2"."_localeCode" = ? WHERE "_sub0"."_targetUUID" = "WLTags"."UUID" AND "_sub0"."_localeCode" = ? AND "_sub2"."title" = ?)',
      params: ['en', 'en', 'Hallo'],
    });
  });

  it('a locale-scoped child binds the locale; its nested child does not', () => {
    deepStrictEqual(
      compileTranslatable({ sections: { has: { items: { has: { label: 'i3' } } } } }),
      {
        sql: 'EXISTS (SELECT 1 FROM "WLPosts_sections" "_sub0" WHERE "_sub0"."_parentUUID" = "WLPosts"."UUID" AND "_sub0"."_localeCode" = ? AND EXISTS (SELECT 1 FROM "WLPosts_sections_items" "_sub1" WHERE "_sub1"."_parentUUID" = "_sub0"."UUID" AND "_sub1"."label" = ?))',
        params: ['en', 'i3'],
      },
    );
    deepStrictEqual(compileTranslatable({ sections: { empty: true } }), {
      sql: 'NOT EXISTS (SELECT 1 FROM "WLPosts_sections" "_sub0" WHERE "_sub0"."_parentUUID" = "WLPosts"."UUID" AND "_sub0"."_localeCode" = ?)',
      params: ['en'],
    });
  });

  it('alias numbering stays sequential across companion joins', () => {
    deepStrictEqual(
      compileTranslatable({ tags: { has: { label: 'x' } }, book: { has: { title: 'y' } } }),
      {
        sql: '(EXISTS (SELECT 1 FROM "WLPosts_tags" "_sub0" JOIN "WLTags" "_sub1" ON "_sub1"."UUID" = "_sub0"."_targetUUID" LEFT JOIN "WLTags__translations" "_sub2" ON "_sub2"."_parentUUID" = "_sub1"."UUID" AND "_sub2"."_localeCode" = ? WHERE "_sub0"."_parentUUID" = "WLPosts"."UUID" AND "_sub0"."_localeCode" = ? AND "_sub2"."label" = ?) AND EXISTS (SELECT 1 FROM "WLBooks" "_sub3" LEFT JOIN "WLBooks__translations" "_sub4" ON "_sub4"."_parentUUID" = "_sub3"."UUID" AND "_sub4"."_localeCode" = ? WHERE "_sub3"."UUID" = "WLPosts"."book" AND "_sub4"."title" = ?))',
        params: ['en', 'en', 'x', 'en', 'y'],
      },
    );
  });

  it('the effective locale changes every bound slot and nothing in the SQL', () => {
    const en = compileTranslatable({ tags: { has: { label: 'rot' } } });
    const de = compileTranslatable({ tags: { has: { label: 'rot' } } }, 'de');
    strictEqual(de.sql, en.sql);
    deepStrictEqual(de.params, ['de', 'de', 'rot']);
  });
});
