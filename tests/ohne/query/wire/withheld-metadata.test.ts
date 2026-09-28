import { deepStrictEqual, ok, strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { useCollections } from '../../../../src/ohne/collections/use-collections.ts';
import { field } from '../../../../src/ohne/fields/field.ts';
import { queryMetadata } from '../../../../src/ohne/query/metadata.ts';
import { allowedOperators } from '../../../../src/ohne/query/operators.ts';
import {
  conditionLocaleSensitive,
  localeSensitive,
  withheldMetadata,
} from '../../../../src/ohne/query/wire/withheld-metadata.ts';
import { parseCondition } from '../../../../src/utils/index.ts';

useCollections().register('WhTags', {
  name: 'WhTags',
  collection: { fields: { label: field('text') } },
});
useCollections().register('WhPosts', {
  name: 'WhPosts',
  collection: {
    fields: {
      title: field('text', { translatable: true }),
      views: field('integer'),
      tags: field('records', { collection: 'WhTags' }),
    },
  },
});
useCollections().register('WhCtors', {
  name: 'WhCtors',
  collection: { fields: { title: field('text'), constructor: field('text') } },
});

const meta = queryMetadata('WhPosts');

describe('localeSensitive', () => {
  it('is false over plain columns and over `_translations`', () => {
    strictEqual(localeSensitive({ views: 1 }, meta), false);
    strictEqual(localeSensitive({ _translations: { includes: 'en' } }, meta), false);
  });

  it('is true over a translatable column, at any depth of a group', () => {
    strictEqual(localeSensitive({ title: 'Hello' }, meta), true);
    strictEqual(localeSensitive({ or: [{ views: 1 }, { title: 'Hello' }] }, meta), true);
  });

  it('is true over any relation probe', () => {
    strictEqual(localeSensitive({ tags: { has: true } }, meta), true);
    strictEqual(localeSensitive({ tags: { empty: true } }, meta), true);
  });

  it('counts an unparsable condition as sensitive', () => {
    strictEqual(localeSensitive({ views: { nope: 1 } }, meta), true);
  });

  it('reads a parsed node the same way', () => {
    const parsed = parseCondition({ title: 'Hello' });
    ok(parsed.ok);
    strictEqual(conditionLocaleSensitive(parsed.node, meta), true);
  });
});

describe('withheldMetadata', () => {
  it('returns the metadata itself when nothing is withheld', () => {
    strictEqual(withheldMetadata(meta, null, false), meta);
  });

  it('hides every field outside the select', () => {
    const scoped = withheldMetadata(meta, ['title'], false);
    strictEqual(scoped.fields.title.readable, undefined);
    strictEqual(scoped.fields.views.readable, false);
    strictEqual(scoped.fields._translations.readable, false);
  });

  it('sealed, `_translations` stays readable and admits no operator', () => {
    const scoped = withheldMetadata(meta, null, true);
    strictEqual(scoped.fields._translations.readable, undefined);
    deepStrictEqual([...allowedOperators(scoped.fields._translations)], []);
    strictEqual(scoped.fields.title, meta.fields.title);
  });

  it('keeps every field in a null-prototype map, so an inherited name stays unknown', () => {
    const base = queryMetadata('WhCtors');
    const scoped = withheldMetadata(base, ['title'], false);
    strictEqual(Object.getPrototypeOf(scoped.fields), null);
    deepStrictEqual(Object.keys(scoped.fields), Object.keys(base.fields));
  });

  it('never marks the shared entry', () => {
    withheldMetadata(meta, null, true);
    strictEqual(meta.fields._translations.narrowed, undefined);
    strictEqual(allowedOperators(meta.fields._translations).size, 3);
  });
});
