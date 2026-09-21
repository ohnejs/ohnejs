import { doesNotThrow, match, ok, throws } from 'node:assert';
import { describe, it } from 'node:test';

import { useBlocks } from '../../../src/ohne/blocks/use-blocks.ts';
import { useCollections } from '../../../src/ohne/collections/use-collections.ts';
import { isOhneError } from '../../../src/ohne/error/ohne-error.ts';
import { field } from '../../../src/ohne/fields/field.ts';
import { queryUntyped } from '../../../src/ohne/query/query.ts';

useBlocks().register('VHero', {
  name: 'VHero',
  block: {
    fields: { title: field('text'), author: field('record', { collection: 'VUsers' }) },
  },
});
useBlocks().register('VQuote', { name: 'VQuote', block: { fields: { words: field('text') } } });
useBlocks().register('VBanner', { name: 'VBanner', block: { fields: { note: field('text') } } });
useBlocks().register('VTower', {
  name: 'VTower',
  block: { fields: { parts: field('blocks', { allow: ['VTower', 'VHero'] }) } },
});

useCollections().register('VUsers', {
  name: 'VUsers',
  collection: { fields: { name: field('text') } },
});
useCollections().register('VPosts', {
  name: 'VPosts',
  collection: {
    fields: {
      title: field('text'),
      content: field('blocks', { allow: ['VHero', 'VQuote', 'VTower'] }),
    },
  },
});

interface HasScope {
  where(field: string, value: unknown): HasScope;
}

interface HasCollector {
  has(build: (q: HasScope) => unknown): unknown;
}

interface FieldWhere {
  where(field: string, build: (w: HasCollector) => unknown): unknown;
}

function blockError(title: RegExp, body?: RegExp): (error: unknown) => boolean {
  return (error: unknown) => {
    ok(isOhneError(error));
    match(error.title ?? '', title);
    if (body) match([error.body].flat().join('\n'), body);
    return true;
  };
}

describe('validateCondition gates a blocks has behind its discriminator', () => {
  it('accepts a bare has and an empty, no discriminator needed', () => {
    doesNotThrow(() => queryUntyped('VPosts').where({ content: { has: true } }));
    doesNotThrow(() => queryUntyped('VPosts').where({ content: { empty: true } }));
  });

  it('accepts a discriminator-only scope', () => {
    doesNotThrow(() => queryUntyped('VPosts').where({ content: { has: { block: 'VHero' } } }));
  });

  it('accepts subfield conditions beside the discriminator', () => {
    doesNotThrow(() =>
      queryUntyped('VPosts').where({
        content: { has: { block: 'VHero', title: { contains: 'x' } } },
      }),
    );
  });

  it('accepts the fluent callback form, lowered to the same grammar', () => {
    const builder = queryUntyped('VPosts') as unknown as FieldWhere;
    doesNotThrow(() =>
      builder.where('content', (w) => w.has((q) => q.where('block', 'VHero').where('title', 'x'))),
    );
  });

  it('accepts a blocks tower, each scope narrowed by its own discriminator', () => {
    doesNotThrow(() =>
      queryUntyped('VPosts').where({
        content: {
          has: { block: 'VTower', parts: { has: { block: 'VHero', title: 'x' } } },
        },
      }),
    );
  });

  it('rejects a scope without a discriminator, showing the shape', () => {
    throws(
      () => queryUntyped('VPosts').where({ content: { has: { title: 'x' } } }),
      blockError(
        /A `has` on `content` must name its block type/,
        /bare `block` equality[\s\S]*\{ has: \{ block: 'Hero', \.\.\. \} \}/,
      ),
    );
  });

  it('rejects a negated discriminator', () => {
    throws(
      () => queryUntyped('VPosts').where({ content: { has: { not: { block: 'VHero' } } } }),
      blockError(/A `has` on `content` must name its block type/),
    );
  });

  it('rejects an `in` discriminator', () => {
    throws(
      () => queryUntyped('VPosts').where({ content: { has: { block: { in: ['VHero'] } } } }),
      blockError(/A `has` on `content` must name its block type/),
    );
  });

  it('rejects a discriminator inside an `or`', () => {
    throws(
      () =>
        queryUntyped('VPosts').where({
          content: { has: { or: [{ block: 'VHero' }, { block: 'VQuote' }] } },
        }),
      blockError(/A `has` on `content` must name its block type/),
    );
  });

  it('rejects an unknown type, suggesting the closest allowed one', () => {
    throws(
      () => queryUntyped('VPosts').where({ content: { has: { block: 'VHeros' } } }),
      blockError(/Unknown block type `VHeros`/, /Did you mean `VHero`\?/),
    );
  });

  it('rejects a registered type outside the allow set, listing the allowed ones', () => {
    throws(
      () => queryUntyped('VPosts').where({ content: { has: { block: 'VBanner' } } }),
      blockError(
        /Unknown block type `VBanner`/,
        /Allowed types:\n- `VHero`\n- `VQuote`\n- `VTower`/,
      ),
    );
  });

  it('rejects an unknown subfield inside the scope, suggesting the near one', () => {
    throws(
      () => queryUntyped('VPosts').where({ content: { has: { block: 'VHero', titl: 'x' } } }),
      blockError(/Unknown field `titl` on `VPosts.content`/, /Did you mean `title`\?/),
    );
  });

  it('re-scopes a nested has on a record inside the block to its target collection', () => {
    doesNotThrow(() =>
      queryUntyped('VPosts').where({
        content: { has: { block: 'VHero', author: { has: { name: 'Azshara' } } } },
      }),
    );
    throws(
      () =>
        queryUntyped('VPosts').where({
          content: { has: { block: 'VHero', author: { has: { nam: 'Azshara' } } } },
        }),
      blockError(/Unknown field `nam` on `VUsers`/, /Did you mean `name`\?/),
    );
  });

  it('treats a stray second discriminator as an unknown field in the per-type scope', () => {
    throws(
      () =>
        queryUntyped('VPosts').where({
          content: { has: { block: 'VHero', and: [{ block: 'VQuote' }] } },
        }),
      blockError(/Unknown field `block` on `VPosts.content`/),
    );
  });

  it('requires a discriminator at every tower depth, naming the inner field', () => {
    throws(
      () =>
        queryUntyped('VPosts').where({
          content: { has: { block: 'VTower', parts: { has: { title: 'x' } } } },
        }),
      blockError(/A `has` on `parts` must name its block type/),
    );
  });
});
