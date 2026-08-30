import { deepStrictEqual, notStrictEqual, strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import type { AnyHandler, Route } from '../../../../src/ohne/routes/route.ts';

import copyPost from '../../../../src/layer/api/collections/[collection]/[uuid]/translations/copy.post.ts';
import { useCollections } from '../../../../src/ohne/collections/use-collections.ts';
import { SQLiteDialect } from '../../../../src/ohne/database/dialects/sqlite/dialect.ts';
import { buildDesiredSchema } from '../../../../src/ohne/database/schema/desired.ts';
import { syncDatabase } from '../../../../src/ohne/database/schema/sync.ts';
import { registerDatabase, registerDialect } from '../../../../src/ohne/database/use-database.ts';
import { field } from '../../../../src/ohne/fields/field.ts';
import { useFields } from '../../../../src/ohne/fields/use-fields.ts';
import { dispatch } from '../../../../src/ohne/http/dispatch.ts';
import { useLayers } from '../../../../src/ohne/layers/use-layers.ts';
import { usePrinter } from '../../../../src/ohne/printer/use-printer.ts';
import { queryUntyped } from '../../../../src/ohne/query/query.ts';

usePrinter().configure({ stream: { write: () => true } });

useLayers().add({
  path: '/translations-copy-route',
  input: { collections: { locales: ['en', 'de', 'fr'], defaultLocale: 'en' } },
});

useCollections().register('CpPosts', {
  name: 'CpPosts',
  collection: {
    api: { update: 'public' },
    fields: {
      title: field('text', { translatable: true }),
      shared: field('text'),
      sections: field('repeater', {
        translatable: true,
        fields: {
          heading: field('text'),
          stamp: field('integer', { writable: false, nullable: true }),
        },
      }),
    },
  },
});
useCollections().register('CpHooked', {
  name: 'CpHooked',
  collection: {
    api: { update: 'public' },
    copyTranslation: ({ input, targetLocale }) => ({
      ...input,
      title: `${String(input.title)} (${targetLocale})`,
      shared: 'HACKED',
      slug: 'SNEAK',
      bogus: true,
    }),
    fields: {
      title: field('text', { translatable: true }),
      shared: field('text'),
      slug: field('text', { translatable: true, immutable: true, nullable: true }),
    },
  },
});
useCollections().register('CpPlain', {
  name: 'CpPlain',
  collection: { api: { update: 'public' }, fields: { label: field('text') } },
});
useCollections().register('CpGuarded', {
  name: 'CpGuarded',
  collection: { api: { update: true }, fields: { title: field('text', { translatable: true }) } },
});

const dialect = new SQLiteDialect();
const db = await dialect.connect(':memory:');
registerDialect(dialect);
registerDatabase(db);
await syncDatabase(db, dialect, {
  desired: buildDesiredSchema(useCollections(), useFields() as never),
});

const postA = (
  await queryUntyped('CpPosts').createOrThrow({
    title: 'First',
    shared: 'common',
    sections: [{ heading: 'One', stamp: 7 }],
  })
).UUID as string;
const postB = (
  await queryUntyped('CpPosts').createOrThrow({ title: 'Second', shared: 'common', sections: [] })
).UUID as string;
await queryUntyped('CpPosts')
  .locale('de')
  .where({ UUID: postB })
  .updateOrThrow({ title: 'Zweite' });
const hooked = (
  await queryUntyped('CpHooked').createOrThrow({ title: 'Base', shared: 'keep', slug: 'orig' })
).UUID as string;
const plain = (await queryUntyped('CpPlain').createOrThrow({ label: 'flat' })).UUID as string;

const ROUTE: Route = {
  method: 'POST',
  pattern: '/collections/[collection]/[uuid]/translations/copy',
  file: '/collections/[collection]/[uuid]/translations/copy.ts',
  layer: 'ohne',
  handler: copyPost as AnyHandler,
};

async function call(
  params: Record<string, string>,
  payload: Record<string, unknown> = {},
  qs = '',
): Promise<{ status: number; body: unknown }> {
  const url = `http://x.test/collections/${params.collection}/${params.uuid}/translations/copy${qs}`;
  const request = new Request(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const { response } = await dispatch(ROUTE, request, new URL(url), params);
  const text = await response.text();
  return { status: response.status, body: text === '' ? null : JSON.parse(text) };
}

describe('POST /collections/[collection]/[uuid]/translations/copy', () => {
  it('materializes the target locale with the source translatable values', async () => {
    const { status } = await call({ collection: 'cp-posts', uuid: postA }, {}, '?locale=de');
    strictEqual(status, 200);
    const en = (await queryUntyped('CpPosts').where({ UUID: postA }).findFirst()) ?? {};
    const de =
      (await queryUntyped('CpPosts').locale('de').where({ UUID: postA }).findFirst()) ?? {};
    strictEqual(de.title, 'First');
    strictEqual(de.shared, 'common');
    const source = (en.sections as { UUID: string; heading: string; stamp: number | null }[])[0];
    const copied = (de.sections as { UUID: string; heading: string; stamp: number | null }[])[0];
    strictEqual(copied.heading, source.heading);
    notStrictEqual(copied.UUID, source.UUID);
    strictEqual(source.stamp, 7);
    strictEqual(copied.stamp, null);
  });

  it('copies from the `source` locale the body names', async () => {
    const { status, body } = await call(
      { collection: 'cp-posts', uuid: postB },
      { source: 'de' },
      '?locale=fr',
    );
    strictEqual(status, 200);
    strictEqual((body as { title: string }).title, 'Zweite');
  });

  it('applies the hook shaping and clamps what it may write', async () => {
    const { status } = await call({ collection: 'cp-hooked', uuid: hooked }, {}, '?locale=de');
    strictEqual(status, 200);
    const de = await queryUntyped('CpHooked').locale('de').where({ UUID: hooked }).findFirst();
    strictEqual(de?.title, 'Base (de)');
    strictEqual(de?.slug, null);
    const en = await queryUntyped('CpHooked').where({ UUID: hooked }).findFirst();
    strictEqual(en?.shared, 'keep');
    strictEqual(en?.slug, 'orig');
  });

  it('rejects a copy whose source and target resolve to the same locale', async () => {
    const explicit = await call(
      { collection: 'cp-posts', uuid: postA },
      { source: 'de' },
      '?locale=de',
    );
    strictEqual(explicit.status, 400);
    deepStrictEqual((explicit.body as { data?: unknown }).data, { code: 'sameLocale', path: '' });
    strictEqual((await call({ collection: 'cp-posts', uuid: postA })).status, 400);
  });

  it('rejects an unknown `source` locale', async () => {
    const { status, body } = await call({ collection: 'cp-posts', uuid: postA }, { source: 'zz' });
    strictEqual(status, 400);
    deepStrictEqual((body as { data?: unknown }).data, { code: 'invalidLocale', path: 'source' });
  });

  it('rejects an unknown body key', async () => {
    const { status, body } = await call({ collection: 'cp-posts', uuid: postA }, { target: 'de' });
    strictEqual(status, 400);
    deepStrictEqual((body as { data?: unknown }).data, { code: 'unknownParam', path: 'target' });
  });

  it('404s an unknown UUID', async () => {
    const { status } = await call({ collection: 'cp-posts', uuid: 'missing' }, {}, '?locale=de');
    strictEqual(status, 404);
  });

  it('404s a non-translatable collection', async () => {
    strictEqual(
      (await call({ collection: 'cp-plain', uuid: plain }, {}, '?locale=de')).status,
      404,
    );
  });

  it('401s a guarded copy without a user', async () => {
    strictEqual(
      (await call({ collection: 'cp-guarded', uuid: postA }, {}, '?locale=de')).status,
      401,
    );
  });
});
