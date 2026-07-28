import { deepStrictEqual, ok, strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import type { FieldInstance } from '../../../../src/ohne/fields/field.ts';
import type { FieldTypeName } from '../../../../src/ohne/fields/known-fields.ts';

import { useBlocks } from '../../../../src/ohne/blocks/use-blocks.ts';
import { useCollections } from '../../../../src/ohne/collections/use-collections.ts';
import { SQLiteDialect } from '../../../../src/ohne/database/dialects/sqlite/dialect.ts';
import { buildDesiredSchema } from '../../../../src/ohne/database/schema/desired.ts';
import { syncDatabase } from '../../../../src/ohne/database/schema/sync.ts';
import { defineField } from '../../../../src/ohne/fields/define-field.ts';
import { field } from '../../../../src/ohne/fields/field.ts';
import { useFields } from '../../../../src/ohne/fields/use-fields.ts';
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

useBlocks().register('WBQuote', {
  name: 'WBQuote',
  block: { fields: { words: field('text') } },
});
useBlocks().register('WBHero', {
  name: 'WBHero',
  block: {
    fields: {
      title: field('text'),
      author: field('record', { collection: 'WAuthors' }),
      items: field('repeater', { fields: { label: field('text') } }),
      nested: field('blocks', { allow: ['WBQuote'] }),
    },
  },
});
useCollections().register('WBPages', {
  name: 'WBPages',
  collection: {
    fields: {
      title: field('text'),
      tags: field('records', { collection: 'WTags' }),
      content: field('blocks', { allow: ['WBHero', 'WBQuote'] }),
    },
  },
});
useCollections().register('WLBPages', {
  name: 'WLBPages',
  collection: {
    fields: { content: field('blocks', { translatable: true, allow: ['WBHero'] }) },
  },
});

useFields().register('WJList', {
  name: 'WJList' as FieldTypeName,
  fieldType: defineField({ columnType: 'json', jsonList: true, forceNullable: true }),
});
useCollections().register('WJPosts', {
  name: 'WJPosts',
  collection: {
    fields: { labels: { type: 'WJList', options: {} } as unknown as FieldInstance },
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

describe('compileWhere blocks', () => {
  it('a discriminator-only has pins the wrapper type without a per-type join', () => {
    deepStrictEqual(compileOn('WBPages', { content: { has: { block: 'WBHero' } } }), {
      sql: 'EXISTS (SELECT 1 FROM "WBPages_content" "_sub0" WHERE "_sub0"."_parentUUID" = "WBPages"."UUID" AND "_sub0"."_blockType" = ?)',
      params: ['WBHero'],
    });
  });

  it('a subfield condition joins the per-type table and compiles over the join alias', () => {
    deepStrictEqual(compileOn('WBPages', { content: { has: { block: 'WBHero', title: 'x' } } }), {
      sql: 'EXISTS (SELECT 1 FROM "WBPages_content" "_sub0" JOIN "block_WBHero" "_sub1" ON "_sub1"."UUID" = "_sub0"."_blockUUID" WHERE "_sub0"."_parentUUID" = "WBPages"."UUID" AND "_sub0"."_blockType" = ? AND "_sub1"."title" = ?)',
      params: ['WBHero', 'x'],
    });
  });

  it('sibling subfield conditions AND inside the block scope', () => {
    deepStrictEqual(
      compileOn('WBPages', {
        content: { has: { block: 'WBHero', title: 'x', author: { has: true } } },
      }),
      {
        sql: 'EXISTS (SELECT 1 FROM "WBPages_content" "_sub0" JOIN "block_WBHero" "_sub1" ON "_sub1"."UUID" = "_sub0"."_blockUUID" WHERE "_sub0"."_parentUUID" = "WBPages"."UUID" AND "_sub0"."_blockType" = ? AND ("_sub1"."title" = ? AND "_sub1"."author" IS NOT NULL))',
        params: ['WBHero', 'x'],
      },
    );
  });

  it('a record subfield has re-scopes to its target collection with a fresh alias', () => {
    deepStrictEqual(
      compileOn('WBPages', {
        content: { has: { block: 'WBHero', author: { has: { name: 'Ada' } } } },
      }),
      {
        sql: 'EXISTS (SELECT 1 FROM "WBPages_content" "_sub0" JOIN "block_WBHero" "_sub1" ON "_sub1"."UUID" = "_sub0"."_blockUUID" WHERE "_sub0"."_parentUUID" = "WBPages"."UUID" AND "_sub0"."_blockType" = ? AND EXISTS (SELECT 1 FROM "WAuthors" "_sub2" WHERE "_sub2"."UUID" = "_sub1"."author" AND "_sub2"."name" = ?))',
        params: ['WBHero', 'Ada'],
      },
    );
  });

  it('a repeater subfield has correlates its child table on the block alias', () => {
    deepStrictEqual(
      compileOn('WBPages', {
        content: { has: { block: 'WBHero', items: { has: { label: 'i1' } } } },
      }),
      {
        sql: 'EXISTS (SELECT 1 FROM "WBPages_content" "_sub0" JOIN "block_WBHero" "_sub1" ON "_sub1"."UUID" = "_sub0"."_blockUUID" WHERE "_sub0"."_parentUUID" = "WBPages"."UUID" AND "_sub0"."_blockType" = ? AND EXISTS (SELECT 1 FROM "block_WBHero_items" "_sub2" WHERE "_sub2"."_parentUUID" = "_sub1"."UUID" AND "_sub2"."label" = ?))',
        params: ['WBHero', 'i1'],
      },
    );
  });

  it('blocks nest in blocks, each level drawing fresh aliases', () => {
    deepStrictEqual(
      compileOn('WBPages', {
        content: { has: { block: 'WBHero', nested: { has: { block: 'WBQuote', words: 'w' } } } },
      }),
      {
        sql: 'EXISTS (SELECT 1 FROM "WBPages_content" "_sub0" JOIN "block_WBHero" "_sub1" ON "_sub1"."UUID" = "_sub0"."_blockUUID" WHERE "_sub0"."_parentUUID" = "WBPages"."UUID" AND "_sub0"."_blockType" = ? AND EXISTS (SELECT 1 FROM "block_WBHero_nested" "_sub2" JOIN "block_WBQuote" "_sub3" ON "_sub3"."UUID" = "_sub2"."_blockUUID" WHERE "_sub2"."_parentUUID" = "_sub1"."UUID" AND "_sub2"."_blockType" = ? AND "_sub3"."words" = ?))',
        params: ['WBHero', 'WBQuote', 'w'],
      },
    );
  });

  it('negation wraps the blocks EXISTS', () => {
    deepStrictEqual(compileOn('WBPages', { content: { not: { has: { block: 'WBHero' } } } }), {
      sql: 'NOT (EXISTS (SELECT 1 FROM "WBPages_content" "_sub0" WHERE "_sub0"."_parentUUID" = "WBPages"."UUID" AND "_sub0"."_blockType" = ?))',
      params: ['WBHero'],
    });
  });

  it('a bare has and empty probe the wrapper alone, no type predicate', () => {
    deepStrictEqual(compileOn('WBPages', { content: { has: true } }), {
      sql: 'EXISTS (SELECT 1 FROM "WBPages_content" "_sub0" WHERE "_sub0"."_parentUUID" = "WBPages"."UUID")',
      params: [],
    });
    deepStrictEqual(compileOn('WBPages', { content: { empty: true } }), {
      sql: 'NOT EXISTS (SELECT 1 FROM "WBPages_content" "_sub0" WHERE "_sub0"."_parentUUID" = "WBPages"."UUID")',
      params: [],
    });
  });

  it('a locale-scoped wrapper binds the locale in bare, empty, and discriminated forms', () => {
    deepStrictEqual(compileOn('WLBPages', { content: { has: true } }), {
      sql: 'EXISTS (SELECT 1 FROM "WLBPages_content" "_sub0" WHERE "_sub0"."_parentUUID" = "WLBPages"."UUID" AND "_sub0"."_localeCode" = ?)',
      params: ['en'],
    });
    deepStrictEqual(compileOn('WLBPages', { content: { empty: true } }), {
      sql: 'NOT EXISTS (SELECT 1 FROM "WLBPages_content" "_sub0" WHERE "_sub0"."_parentUUID" = "WLBPages"."UUID" AND "_sub0"."_localeCode" = ?)',
      params: ['en'],
    });
    deepStrictEqual(compileOn('WLBPages', { content: { has: { block: 'WBHero', title: 't' } } }), {
      sql: 'EXISTS (SELECT 1 FROM "WLBPages_content" "_sub0" JOIN "block_WBHero" "_sub1" ON "_sub1"."UUID" = "_sub0"."_blockUUID" WHERE "_sub0"."_parentUUID" = "WLBPages"."UUID" AND "_sub0"."_localeCode" = ? AND "_sub0"."_blockType" = ? AND "_sub1"."title" = ?)',
      params: ['en', 'WBHero', 't'],
    });
  });

  it('the alias counter threads across a mixed relation and blocks condition', () => {
    deepStrictEqual(
      compileOn('WBPages', {
        tags: { has: { label: 'red' } },
        content: { has: { block: 'WBHero', title: 'x' } },
      }),
      {
        sql: '(EXISTS (SELECT 1 FROM "WBPages_tags" "_sub0" JOIN "WTags" "_sub1" ON "_sub1"."UUID" = "_sub0"."_targetUUID" WHERE "_sub0"."_parentUUID" = "WBPages"."UUID" AND "_sub1"."label" = ?) AND EXISTS (SELECT 1 FROM "WBPages_content" "_sub2" JOIN "block_WBHero" "_sub3" ON "_sub3"."UUID" = "_sub2"."_blockUUID" WHERE "_sub2"."_parentUUID" = "WBPages"."UUID" AND "_sub2"."_blockType" = ? AND "_sub3"."title" = ?))',
        params: ['red', 'WBHero', 'x'],
      },
    );
  });
});

describe('compileWhere list membership', () => {
  it('`includes` guards the column non-null and probes json_each', () => {
    deepStrictEqual(compileOn('WJPosts', { labels: { includes: 'a' } }), {
      sql: '("labels" IS NOT NULL AND EXISTS (SELECT 1 FROM json_each("labels") WHERE json_each.value IN (?)))',
      params: ['a'],
    });
  });

  it('a boolean element probes as `1`', () => {
    deepStrictEqual(compileOn('WJPosts', { labels: { includes: true } }), {
      sql: '("labels" IS NOT NULL AND EXISTS (SELECT 1 FROM json_each("labels") WHERE json_each.value IN (?)))',
      params: [1],
    });
  });

  it('`includesAll` counts distinct matches against the list length', () => {
    deepStrictEqual(compileOn('WJPosts', { labels: { includesAll: ['a', 'b'] } }), {
      sql: '("labels" IS NOT NULL AND (SELECT COUNT(DISTINCT json_each.value) FROM json_each("labels") WHERE json_each.value IN (?, ?)) = 2)',
      params: ['a', 'b'],
    });
  });

  it('`includesAll` dedups, binding a duplicate once', () => {
    deepStrictEqual(compileOn('WJPosts', { labels: { includesAll: ['a', 'a'] } }), {
      sql: '("labels" IS NOT NULL AND (SELECT COUNT(DISTINCT json_each.value) FROM json_each("labels") WHERE json_each.value IN (?)) = 1)',
      params: ['a'],
    });
  });

  it('an empty `includesAll` is vacuously true inside the guard', () => {
    deepStrictEqual(compileOn('WJPosts', { labels: { includesAll: [] } }), {
      sql: '("labels" IS NOT NULL AND 1 = 1)',
      params: [],
    });
  });

  it('`includesAny` exist-checks a placeholder per value', () => {
    deepStrictEqual(compileOn('WJPosts', { labels: { includesAny: ['a', 'b'] } }), {
      sql: '("labels" IS NOT NULL AND EXISTS (SELECT 1 FROM json_each("labels") WHERE json_each.value IN (?, ?)))',
      params: ['a', 'b'],
    });
  });

  it('an empty `includesAny` matches nothing inside the guard', () => {
    deepStrictEqual(compileOn('WJPosts', { labels: { includesAny: [] } }), {
      sql: '("labels" IS NOT NULL AND 1 = 0)',
      params: [],
    });
  });

  it('negation wraps the probe, the null guard staying outside', () => {
    deepStrictEqual(compileOn('WJPosts', { labels: { not: { includes: 'a' } } }), {
      sql: '("labels" IS NOT NULL AND NOT (EXISTS (SELECT 1 FROM json_each("labels") WHERE json_each.value IN (?))))',
      params: ['a'],
    });
  });
});

const db = await dialect.connect(':memory:');
await syncDatabase(db, dialect, {
  desired: buildDesiredSchema(useCollections(), useFields() as never, useBlocks()),
});
await db.run(
  'INSERT INTO "WBPages" ("UUID", "_updatedAt", "title") VALUES (?, ?, ?), (?, ?, ?), (?, ?, ?)',
  ['p1', 0, 'Alpha', 'p2', 0, 'Beta', 'p3', 0, 'Gamma'],
);
await db.run('INSERT INTO "block_WBHero" ("UUID", "title") VALUES (?, ?), (?, ?)', [
  'h1',
  'Hi',
  'h2',
  'Yo',
]);
await db.run('INSERT INTO "block_WBQuote" ("UUID", "words") VALUES (?, ?)', ['q1', 'Sage']);
await db.run(
  'INSERT INTO "WBPages_content" ("UUID", "_parentUUID", "_parentPosition", "_blockType", "_blockUUID") ' +
    'VALUES (?, ?, ?, ?, ?), (?, ?, ?, ?, ?), (?, ?, ?, ?, ?)',
  ['w1', 'p1', 0, 'WBHero', 'h1', 'w2', 'p2', 0, 'WBQuote', 'q1', 'w3', 'p3', 0, 'WBHero', 'h2'],
);

async function pageTitles(condition: Record<string, unknown>): Promise<string[]> {
  const parsed = parseCondition(condition);
  if (!parsed.ok) throw new Error(`parse failed: ${parsed.error.code}`);
  const fragment = compileWhere(parsed.node, queryMetadata('WBPages'), dialect, 'en');
  const rows = await db.query<{ title: string }>(
    `SELECT "title" FROM "WBPages" WHERE ${fragment.sql} ORDER BY "title"`,
    fragment.params,
  );
  return rows.map((row) => row.title);
}

describe('compileWhere blocks behavior', () => {
  it('a discriminator-only has matches rows holding the named type', async () => {
    deepStrictEqual(await pageTitles({ content: { has: { block: 'WBHero' } } }), [
      'Alpha',
      'Gamma',
    ]);
    deepStrictEqual(await pageTitles({ content: { has: { block: 'WBQuote' } } }), ['Beta']);
  });

  it('a subfield condition matches only rows whose instance satisfies it', async () => {
    deepStrictEqual(await pageTitles({ content: { has: { block: 'WBHero', title: 'Hi' } } }), [
      'Alpha',
    ]);
    deepStrictEqual(await pageTitles({ content: { has: { block: 'WBHero', title: 'Sage' } } }), []);
  });
});
