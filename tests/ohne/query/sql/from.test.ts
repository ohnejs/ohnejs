import { deepStrictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import type { ConditionNode } from '../../../../src/utils/index.ts';

import { useCollections } from '../../../../src/ohne/collections/use-collections.ts';
import { SQLiteDialect } from '../../../../src/ohne/database/dialects/sqlite/dialect.ts';
import { field } from '../../../../src/ohne/fields/field.ts';
import { queryMetadata } from '../../../../src/ohne/query/metadata.ts';
import { compileFrom } from '../../../../src/ohne/query/sql/from.ts';
import { parseCondition } from '../../../../src/utils/index.ts';

useCollections().register('FRUsers', {
  name: 'FRUsers',
  collection: { fields: { name: field('text') } },
});
useCollections().register('FRTags', {
  name: 'FRTags',
  collection: { fields: { label: field('text', { translatable: true }) } },
});
useCollections().register('FRPosts', {
  name: 'FRPosts',
  collection: {
    fields: {
      title: field('text', { translatable: true }),
      views: field('integer'),
      author: field('record', { collection: 'FRUsers', translatable: true }),
      tags: field('records', { collection: 'FRTags' }),
      sections: field('repeater', { translatable: true, fields: { heading: field('text') } }),
    },
  },
});
useCollections().register('FRPlain', {
  name: 'FRPlain',
  collection: { fields: { name: field('text') } },
});

const dialect = new SQLiteDialect();
const posts = queryMetadata('FRPosts');

const MAIN = { sql: 'FROM "FRPosts"', params: [] };
const JOINED = {
  sql: 'FROM "FRPosts" LEFT JOIN "FRPosts__translations" ON "FRPosts__translations"."_parentUUID" = "FRPosts"."UUID" AND "FRPosts__translations"."_localeCode" = ?',
  params: ['de'],
};

function condition(input: Record<string, unknown>): ConditionNode {
  const parsed = parseCondition(input);
  if (!parsed.ok) throw new Error(`parse failed: ${parsed.error.code}`);
  return parsed.node;
}

describe('compileFrom', () => {
  it('reads the main table alone when nothing touches the companion', () => {
    deepStrictEqual(compileFrom(posts, {}, 'de', dialect), MAIN);
    deepStrictEqual(
      compileFrom(posts, { fields: ['views'], condition: null }, 'de', dialect),
      MAIN,
    );
    deepStrictEqual(
      compileFrom(posts, { condition: condition({ views: { atLeast: 5 } }) }, 'de', dialect),
      MAIN,
    );
    deepStrictEqual(
      compileFrom(posts, { order: [{ field: 'views', direction: 'asc' }] }, 'de', dialect),
      MAIN,
    );
  });

  it('joins the companion when the fields list names a companion column', () => {
    deepStrictEqual(compileFrom(posts, { fields: ['title'] }, 'de', dialect), JOINED);
  });

  it('joins the companion for a full-record read', () => {
    deepStrictEqual(compileFrom(posts, { fields: null }, 'de', dialect), JOINED);
  });

  it('joins the companion when a compare leaf addresses a companion column', () => {
    deepStrictEqual(
      compileFrom(posts, { condition: condition({ title: 'Hallo' }) }, 'de', dialect),
      JOINED,
    );
  });

  it('joins the companion when a has leaf addresses a companion record', () => {
    deepStrictEqual(
      compileFrom(
        posts,
        { condition: condition({ author: { has: { name: 'Ada' } } }) },
        'de',
        dialect,
      ),
      JOINED,
    );
  });

  it('joins the companion when an order entry names a companion column', () => {
    deepStrictEqual(
      compileFrom(posts, { order: [{ field: 'title', direction: 'desc' }] }, 'de', dialect),
      JOINED,
    );
  });

  it('binds the effective locale as the single join parameter', () => {
    deepStrictEqual(compileFrom(posts, { fields: ['title'] }, 'en', dialect).params, ['en']);
  });

  it('never counts a nested condition: the EXISTS joins its own companion', () => {
    deepStrictEqual(
      compileFrom(
        posts,
        { condition: condition({ tags: { has: { label: 'rot' } } }) },
        'de',
        dialect,
      ),
      MAIN,
    );
    deepStrictEqual(
      compileFrom(
        posts,
        { condition: condition({ sections: { has: { heading: 'Intro' } } }) },
        'de',
        dialect,
      ),
      MAIN,
    );
  });

  it('never joins over a non-translatable collection', () => {
    const plain = queryMetadata('FRPlain');
    const bare = { sql: 'FROM "FRPlain"', params: [] };
    deepStrictEqual(compileFrom(plain, { fields: null }, 'de', dialect), bare);
    deepStrictEqual(
      compileFrom(plain, { condition: condition({ name: 'x' }) }, 'de', dialect),
      bare,
    );
  });
});
