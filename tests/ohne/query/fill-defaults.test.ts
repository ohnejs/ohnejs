import { deepStrictEqual, notStrictEqual, ok, rejects, strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import type { FieldWriteContext } from '../../../src/ohne/fields/context.ts';

import { useBlocks } from '../../../src/ohne/blocks/use-blocks.ts';
import { useCollections } from '../../../src/ohne/collections/use-collections.ts';
import { buildDesiredSchema } from '../../../src/ohne/database/schema/desired.ts';
import { syncDatabase } from '../../../src/ohne/database/schema/sync.ts';
import {
  registerDatabase,
  registerDialect,
  useDatabase,
} from '../../../src/ohne/database/use-database.ts';
import { field } from '../../../src/ohne/fields/field.ts';
import { useFields } from '../../../src/ohne/fields/use-fields.ts';
import { useLayers } from '../../../src/ohne/layers/use-layers.ts';
import { fillDefaults } from '../../../src/ohne/query/fill-defaults.ts';
import { queryUntyped } from '../../../src/ohne/query/query.ts';
import { isArray, isObject } from '../../../src/utils/index.ts';
import { connectTest, dialect } from '../../_dialect.ts';

useLayers().add({
  path: '/fill-defaults',
  input: { collections: { locales: ['en', 'de'], defaultLocale: 'en' } },
});

useBlocks().register('FDHero', {
  name: 'FDHero',
  block: {
    fields: {
      heading: field('text'),
      cta: field('object', { nullable: true, fields: { label: field('text') } }),
      columns: field('repeater', {
        fields: { body: field('text', { nullable: true }), n: field('integer', { default: 1 }) },
      }),
      tone: field('select', { choices: ['a', 'b'], default: 'a' }),
    },
  },
});

useCollections().register('FDAuthors', {
  name: 'FDAuthors',
  collection: { fields: { name: field('text') } },
});

let echoes = 0;
useCollections().register('FDPages', {
  name: 'FDPages',
  collection: {
    fields: {
      title: field('text'),
      note: field('text', { nullable: true }),
      greet: field('text', { default: 'Hello' }),
      echo: field('text', {
        default: (ctx: FieldWriteContext) => {
          echoes++;
          return `${String(ctx.input.title)}!`;
        },
      }),
      slugged: field('slug', { default: 'Hello World' }),
      picks: field('multiSelect', { choices: ['x', 'y'] }),
      tags: field('records', { collection: 'FDAuthors' }),
      box: field('object', { nullable: true, fields: { label: field('text') } }),
      boxed: field('object', {
        default: () => ({ note: 'n' }),
        fields: { note: field('text'), extra: field('integer', { default: 7 }) },
      }),
      rows: field('repeater', { fields: { h: field('text', { nullable: true }) } }),
      content: field('blocks', { allow: ['FDHero'] }),
      kind: field('select', { choices: ['plain', 'sale'], default: 'plain' }),
      discount: field('integer', { nullable: true, default: 5, when: { kind: 'sale' } }),
      gated: field('repeater', { min: 1, when: { kind: 'sale' }, fields: { h: field('text') } }),
      secret: field('text', { readable: false, default: 's' }),
    },
  },
});

useCollections().register('FDGates', {
  name: 'FDGates',
  collection: {
    fields: {
      mode: field('object', {
        fields: { on: field('boolean', { default: true }), label: field('text') },
      }),
      extras: field('repeater', {
        min: 1,
        when: { 'mode.on': true },
        fields: { h: field('text') },
      }),
      hiddenKind: field('text', { readable: false, default: 'sale' }),
      offers: field('repeater', {
        min: 1,
        when: { hiddenKind: 'sale' },
        fields: { h: field('text') },
      }),
    },
  },
});

useCollections().register('FDReject', {
  name: 'FDReject',
  collection: {
    fields: {
      title: field('text'),
      code: field('text', {
        default: () => 'bad',
        validators: [(value: string) => (value === 'bad' ? 'rejected' : undefined)],
      }),
    },
  },
});

useCollections().register('FDSide', {
  name: 'FDSide',
  collection: {
    fields: {
      count: field('integer', {
        default: async (ctx: FieldWriteContext) => {
          await ctx.tx.run('INSERT INTO "FDAuthors" ("UUID","_updatedAt","name") VALUES (?,?,?)', [
            crypto.randomUUID(),
            1,
            'side',
          ]);
          const row = await ctx.tx.queryOne<{ c: number }>('SELECT count(*) AS c FROM "FDAuthors"');
          return Number(row?.c);
        },
      }),
      lang: field('text', { default: (ctx: FieldWriteContext) => ctx.locale }),
    },
  },
});

const db = await connectTest();
registerDialect(dialect);
registerDatabase(db);
await syncDatabase(db, dialect, {
  desired: buildDesiredSchema(useCollections(), useFields() as never, useBlocks()),
});

/**
 * Drops every `UUID` and `_updatedAt` at any depth, so a fill compares to a write's answer.
 */
function strip(value: unknown): unknown {
  if (isArray(value)) return value.map(strip);
  if (!isObject(value)) return value;
  const out: Record<string, unknown> = {};
  for (const [key, inner] of Object.entries(value)) {
    if (key !== 'UUID' && key !== '_updatedAt') out[key] = strip(inner);
  }
  return out;
}

async function authorCount(): Promise<number> {
  const row = await useDatabase().queryOne<{ c: number }>('SELECT count(*) AS c FROM "FDAuthors"');
  return Number(row?.c);
}

describe('fillDefaults', () => {
  it('fills a create as the create stores it', async () => {
    const input = { title: 'T', content: [{ block: 'FDHero', fields: { heading: 'Hi' } }] };
    const filled = await fillDefaults('FDPages', input, { operation: 'create' });
    const created = await queryUntyped('FDPages').createOrThrow(input);
    deepStrictEqual(strip(filled), strip(created));
    deepStrictEqual(strip(filled), {
      title: 'T',
      note: null,
      greet: 'Hello',
      echo: 'T!',
      slugged: 'hello-world',
      picks: [],
      tags: [],
      box: null,
      boxed: { note: 'n', extra: 7 },
      rows: [],
      content: [{ block: 'FDHero', fields: { heading: 'Hi', cta: null, columns: [], tone: 'a' } }],
      kind: 'plain',
      discount: 5,
      gated: [],
    });
  });

  it('fills provided composites at every depth', async () => {
    const input = {
      title: 'T',
      box: { label: 'L' },
      rows: [{}],
      content: [{ block: 'FDHero', fields: { heading: 'Hi', columns: [{ body: 'b' }] } }],
    };
    const filled = await fillDefaults('FDPages', input, { operation: 'create' });
    deepStrictEqual(strip(filled), strip(await queryUntyped('FDPages').createOrThrow(input)));
  });

  it('runs a callback default once with the input', async () => {
    const before = echoes;
    const filled = await fillDefaults('FDPages', { title: 'Q' }, { operation: 'create' });
    strictEqual(filled.echo, 'Q!');
    strictEqual(echoes - before, 1);
  });

  it('fills only nested items under an update, as the update stores them', async () => {
    const saved = await queryUntyped('FDPages').createOrThrow({ title: 'U' });
    const input = {
      content: [{ block: 'FDHero', fields: { heading: 'New', columns: [{}] } }],
      rows: [{}],
    };
    const filled = await fillDefaults('FDPages', input, { operation: 'update' });
    deepStrictEqual(Object.keys(filled), ['rows', 'content']);
    const [updated] = await queryUntyped('FDPages')
      .where({ UUID: saved.UUID })
      .updateOrThrow(input);
    deepStrictEqual(strip(filled.content), strip(updated.content));
    deepStrictEqual(strip(filled.rows), strip(updated.rows));
  });

  it('keeps a provided item `UUID` and gives a new item one', async () => {
    const filled = await fillDefaults(
      'FDPages',
      {
        rows: [{ UUID: 'kept', h: 'a' }, { h: 'b' }],
        content: [{ block: 'FDHero', UUID: 'block', fields: { heading: 'H' } }],
      },
      { operation: 'update' },
    );
    const rows = filled.rows as { UUID: string }[];
    strictEqual(rows[0].UUID, 'kept');
    ok(typeof rows[1].UUID === 'string');
    notStrictEqual(rows[1].UUID, 'kept');
    strictEqual((filled.content as { UUID: string }[])[0].UUID, 'block');
  });

  it('gates as a create does', async () => {
    const replaced = await fillDefaults(
      'FDPages',
      { title: 'T', discount: 9 },
      { operation: 'create' },
    );
    strictEqual(replaced.discount, 5);
    deepStrictEqual(replaced.gated, []);

    const active = await fillDefaults(
      'FDPages',
      { title: 'T', kind: 'sale' },
      { operation: 'create' },
    );
    strictEqual(active.discount, 5);
    ok(!('gated' in active));
    await rejects(
      queryUntyped('FDPages').createOrThrow({ title: 'T', kind: 'sale' }),
      (error: { errors: Record<string, unknown> }) => error.errors.gated === 'validation.required',
    );
  });

  it('gates on defaulted subfields and hidden fields', async () => {
    const input = { mode: { label: 'L' } };
    const filled = await fillDefaults('FDGates', input, { operation: 'create' });
    deepStrictEqual(strip(filled), { mode: { on: true, label: 'L' } });
    await rejects(
      queryUntyped('FDGates').createOrThrow(input),
      (error: { errors: Record<string, unknown> }) =>
        error.errors.extras === 'validation.required' &&
        error.errors.offers === 'validation.required',
    );
  });

  it('never fills or returns a hidden field', async () => {
    const filled = await fillDefaults(
      'FDPages',
      { title: 'T', secret: 'x' },
      { operation: 'create' },
    );
    ok(!('secret' in filled));
  });

  it('leaves out a default the validators reject', async () => {
    const filled = await fillDefaults('FDReject', { title: 'T' }, { operation: 'create' });
    deepStrictEqual(filled, { title: 'T' });
  });

  it('rolls back what a callback default writes', async () => {
    const before = await authorCount();
    const filled = await fillDefaults('FDSide', {}, { operation: 'create' });
    strictEqual(filled.count, before + 1);
    strictEqual(await authorCount(), before);

    await useDatabase().transaction(async (tx) => {
      await tx.run('INSERT INTO "FDAuthors" ("UUID","_updatedAt","name") VALUES (?,?,?)', [
        'caller',
        1,
        'caller',
      ]);
      const joined = await fillDefaults('FDSide', {}, { operation: 'create', tx });
      strictEqual(joined.count, before + 2);
    });
    strictEqual(await authorCount(), before + 1);
  });

  it('hands the locale to the write context', async () => {
    strictEqual((await fillDefaults('FDSide', {}, { operation: 'create' })).lang, 'en');
    strictEqual(
      (await fillDefaults('FDSide', {}, { operation: 'create', locale: 'DE' })).lang,
      'de',
    );
    await rejects(fillDefaults('FDSide', {}, { operation: 'create', locale: 'fr' }), /fr/);
  });
});
