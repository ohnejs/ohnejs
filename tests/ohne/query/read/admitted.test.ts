import { ok, strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import type { ConditionInput } from '../../../../src/ohne/query/untyped.ts';

import { useCollections } from '../../../../src/ohne/collections/use-collections.ts';
import { field } from '../../../../src/ohne/fields/field.ts';
import { queryMetadata } from '../../../../src/ohne/query/metadata.ts';
import { conditionLocaleSensitive } from '../../../../src/ohne/query/read/admitted.ts';
import { parseCondition } from '../../../../src/utils/index.ts';

useCollections().register('AdTags', {
  name: 'AdTags',
  collection: { fields: { label: field('text') } },
});
useCollections().register('AdPosts', {
  name: 'AdPosts',
  collection: {
    fields: {
      title: field('text', { translatable: true }),
      views: field('integer'),
      tags: field('records', { collection: 'AdTags' }),
    },
  },
});

const meta = queryMetadata('AdPosts');

const sensitive = (where: ConditionInput): boolean => {
  const parsed = parseCondition(where);
  ok(parsed.ok);
  return conditionLocaleSensitive(parsed.node, meta);
};

describe('conditionLocaleSensitive', () => {
  it('is false over plain columns and over `_translations`', () => {
    strictEqual(sensitive({ views: 1 }), false);
    strictEqual(sensitive({ _translations: { includes: 'en' } }), false);
  });

  it('is true over a translatable column, at any depth of a group', () => {
    strictEqual(sensitive({ title: 'Hello' }), true);
    strictEqual(sensitive({ or: [{ views: 1 }, { title: 'Hello' }] }), true);
  });

  it('is true over any relation probe', () => {
    strictEqual(sensitive({ tags: { has: true } }), true);
    strictEqual(sensitive({ tags: { empty: true } }), true);
  });
});
