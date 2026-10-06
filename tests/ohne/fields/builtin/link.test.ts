import { deepStrictEqual, ok, strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import type { Transaction } from '../../../../src/ohne/database/adapter.ts';

import { useCollections } from '../../../../src/ohne/collections/use-collections.ts';
import { link } from '../../../../src/ohne/fields/builtin/link.ts';
import { field } from '../../../../src/ohne/fields/field.ts';
import { queryMetadata } from '../../../../src/ohne/query/metadata.ts';
import { runRecord } from '../../../../src/ohne/query/pipeline/run-record.ts';

type EmitCtx = Parameters<NonNullable<typeof link.emitType>>[0];

const PAGE = '019f3c1a-8b2d-7f4e-9a6b-1c2d3e4f5a6b';
const tx = {} as Transaction;

useCollections().register('LKPage', {
  name: 'LKPage',
  collection: { fields: { name: field('text') } },
});
useCollections().register('LKPost', {
  name: 'LKPost',
  collection: {
    fields: {
      target: field('link', { collections: ['LKPage'] }),
      site: field('link', { nullable: true }),
      ghosted: field('link', { collections: ['LKNope'], nullable: true }),
    },
  },
});

async function create(input: Record<string, unknown>) {
  return runRecord(
    queryMetadata('LKPost'),
    { target: { url: '/t' }, ...input },
    { operation: 'create', tx },
  );
}

async function stored(input: Record<string, unknown>): Promise<Record<string, unknown>> {
  const result = await create(input);
  ok(result.ok, JSON.stringify(result));
  return result.scope.columns;
}

async function failed(input: Record<string, unknown>): Promise<Record<string, unknown>> {
  const result = await create(input);
  ok(!result.ok);
  return { ...result.errors };
}

describe('link emitType', () => {
  const emitCtx = (options: Record<string, unknown>) =>
    ({ options, importType: (_path: string, name: string) => name }) as unknown as EmitCtx;

  it('emits the union of `collections`', () => {
    strictEqual(
      link.emitType!(emitCtx({ collections: ['Pages', 'Posts'] })),
      "Link<'Pages' | 'Posts'>",
    );
  });

  it('emits `never` without `collections`', () => {
    strictEqual(link.emitType!(emitCtx({})), 'Link<never>');
  });
});

describe('link through the write pipeline', () => {
  it('normalizes a well-shaped link', async () => {
    const columns = await stored({
      target: { collection: 'LKPage', record: PAGE, hash: '#top', newTab: false, href: '/p' },
      site: { url: ' https://x.y ', newTab: true, href: '/x' },
    });
    deepStrictEqual(columns.target, { collection: 'LKPage', record: PAGE, hash: 'top' });
    deepStrictEqual(columns.site, { url: 'https://x.y', newTab: true });
  });

  it('reports a broken value at the field itself', async () => {
    deepStrictEqual(await failed({ target: 'https://x.y' }), { target: 'validation.invalidValue' });
    deepStrictEqual(await failed({ target: { newTab: true } }), {
      target: 'validation.invalidValue',
    });
  });

  it('reports an unsafe URL at its key', async () => {
    deepStrictEqual(await failed({ site: { url: 'javascript:x' } }), {
      'site.url': 'validation.invalidLink',
    });
  });

  it('refuses a record link without `collections`', async () => {
    deepStrictEqual(await failed({ site: { collection: 'LKPage', record: PAGE } }), {
      'site.collection': 'validation.invalidChoice',
    });
  });

  it('refuses a record link into a collection the field omits', async () => {
    deepStrictEqual(await failed({ target: { collection: 'LKPost', record: PAGE } }), {
      'target.collection': 'validation.invalidChoice',
    });
  });

  it('refuses a record link into a listed collection that is not registered', async () => {
    deepStrictEqual(await failed({ ghosted: { collection: 'LKNope', record: PAGE } }), {
      'ghosted.collection': 'validation.invalidChoice',
    });
  });

  it('reports a malformed record and an unknown key at their keys', async () => {
    deepStrictEqual(await failed({ target: { collection: 'LKPage', record: 'home', rel: 'x' } }), {
      'target.record': 'validation.invalidValue',
      'target.rel': 'validation.unknownField',
    });
  });

  it('lists a record link at the value itself and a URL link not at all', async () => {
    deepStrictEqual(link.links!({ collection: 'LKPage', record: PAGE }), [
      { path: '', link: { collection: 'LKPage', record: PAGE } },
    ]);
    deepStrictEqual(link.links!({ url: '/a' }), []);
    deepStrictEqual(link.links!('broken'), []);
  });
});
