import { deepStrictEqual, match, ok, rejects, strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import type { DatabaseAdapter, SQLParams } from '../../../../../src/ohne/database/adapter.ts';
import type { FieldQueryMeta } from '../../../../../src/ohne/query/metadata.ts';

import { useBlocks } from '../../../../../src/ohne/blocks/use-blocks.ts';
import { useCollections } from '../../../../../src/ohne/collections/use-collections.ts';
import { SQLiteDialect } from '../../../../../src/ohne/database/dialects/sqlite/dialect.ts';
import { buildDesiredSchema } from '../../../../../src/ohne/database/schema/desired.ts';
import { syncDatabase } from '../../../../../src/ohne/database/schema/sync.ts';
import {
  registerDatabase,
  registerDialect,
} from '../../../../../src/ohne/database/use-database.ts';
import { isOhneError } from '../../../../../src/ohne/error/ohne-error.ts';
import { field } from '../../../../../src/ohne/fields/field.ts';
import { useFields } from '../../../../../src/ohne/fields/use-fields.ts';
import { queryMetadata } from '../../../../../src/ohne/query/metadata.ts';
import { queryUntyped } from '../../../../../src/ohne/query/query.ts';
import { loadBlocks } from '../../../../../src/ohne/query/read/loaders/blocks.ts';

useBlocks().register('BHero', { name: 'BHero', block: { fields: { title: field('text') } } });
useBlocks().register('BQuote', {
  name: 'BQuote',
  block: { fields: { words: field('text'), cite: field('text', { nullable: true }) } },
});
useBlocks().register('BPanel', {
  name: 'BPanel',
  block: {
    fields: {
      heading: field('text'),
      gallery: field('repeater', {
        fields: {
          caption: field('text', { nullable: true }),
          cta: field('blocks', { allow: ['BQuote'] }),
        },
      }),
    },
  },
});

useCollections().register('BPosts', {
  name: 'BPosts',
  collection: {
    fields: {
      title: field('text'),
      content: field('blocks', { allow: ['BHero', 'BQuote', 'BPanel'] }),
    },
  },
});
useCollections().register('BArticles', {
  name: 'BArticles',
  collection: {
    fields: { body: field('blocks', { translatable: true, allow: ['BHero'] }) },
  },
});

const dialect = new SQLiteDialect();
const db = await dialect.connect(':memory:');

let queries = 0;
const counting: DatabaseAdapter = {
  exec: (sql) => db.exec(sql),
  run: (sql, params) => db.run(sql, params),
  query: <T>(sql: string, params?: SQLParams) => {
    queries += 1;
    return db.query<T>(sql, params);
  },
  queryOne: (sql, params) => db.queryOne(sql, params),
  transaction: (fn) => db.transaction(fn),
  close: () => db.close(),
};

registerDialect(dialect);
registerDatabase(counting);
await syncDatabase(db, dialect, {
  desired: buildDesiredSchema(useCollections(), useFields() as never, useBlocks()),
});

const TS = 111;
const contentField = queryMetadata('BPosts').fields.content as FieldQueryMeta;
const bodyField = queryMetadata('BArticles').fields.body as FieldQueryMeta;

async function post(uuid: string, title: string): Promise<void> {
  await db.run('INSERT INTO "BPosts" ("UUID","_updatedAt","title") VALUES (?,?,?)', [
    uuid,
    TS,
    title,
  ]);
}
async function article(uuid: string): Promise<void> {
  await db.run('INSERT INTO "BArticles" ("UUID","_updatedAt") VALUES (?,?)', [uuid, TS]);
}
async function hero(uuid: string, title: string): Promise<void> {
  await db.run('INSERT INTO "block_BHero" ("UUID","title") VALUES (?,?)', [uuid, title]);
}
async function quote(uuid: string, words: string, cite: string | null): Promise<void> {
  await db.run('INSERT INTO "block_BQuote" ("UUID","words","cite") VALUES (?,?,?)', [
    uuid,
    words,
    cite,
  ]);
}
async function panel(uuid: string, heading: string): Promise<void> {
  await db.run('INSERT INTO "block_BPanel" ("UUID","heading") VALUES (?,?)', [uuid, heading]);
}
async function galleryRow(
  uuid: string,
  parent: string,
  position: number,
  caption: string | null,
): Promise<void> {
  await db.run(
    'INSERT INTO "block_BPanel_gallery" ("UUID","_parentUUID","_parentPosition","caption") VALUES (?,?,?,?)',
    [uuid, parent, position, caption],
  );
}
async function place(
  table: string,
  uuid: string,
  parent: string,
  position: number,
  type: string,
  block: string,
): Promise<void> {
  await db.run(
    `INSERT INTO "${table}" ("UUID","_parentUUID","_parentPosition","_blockType","_blockUUID") VALUES (?,?,?,?,?)`,
    [uuid, parent, position, type, block],
  );
}
async function placeLocalized(
  uuid: string,
  parent: string,
  locale: string,
  position: number,
  block: string,
): Promise<void> {
  await db.run(
    'INSERT INTO "BArticles_body" ' +
      '("UUID","_parentUUID","_localeCode","_parentPosition","_blockType","_blockUUID") VALUES (?,?,?,?,?,?)',
    [uuid, parent, locale, position, 'BHero', block],
  );
}

await post('p1', 'First');
await post('p2', 'Second');
await post('p3', 'Third');
await post('p4', 'Fourth');
await post('p5', 'Fifth');

await hero('h1', 'A');
await hero('h2', 'B');
await hero('h3', 'C');
await quote('q1', 'W', null);

// Placed out of position order, so the assembled list proves the wrapper's ORDER BY.
await place('BPosts_content', 'w1', 'p1', 1, 'BQuote', 'q1');
await place('BPosts_content', 'w2', 'p1', 0, 'BHero', 'h1');
await place('BPosts_content', 'w3', 'p1', 2, 'BHero', 'h2');
await place('BPosts_content', 'w4', 'p3', 0, 'BHero', 'h3');

await panel('pn1', 'H');
await place('BPosts_content', 'w5', 'p4', 0, 'BPanel', 'pn1');
await galleryRow('g1', 'pn1', 0, 'C');
await quote('q2', 'W2', 'C2');
await place('block_BPanel_gallery_cta', 'n1', 'g1', 0, 'BQuote', 'q2');

await place('BPosts_content', 'w9', 'p5', 0, 'BHero', 'missing');

await article('a1');
await hero('he1', 'EN');
await hero('hd1', 'DE');
await hero('hd2', 'DE2');
await placeLocalized('lw1', 'a1', 'en', 0, 'he1');
await placeLocalized('lw2', 'a1', 'de', 1, 'hd2');
await placeLocalized('lw3', 'a1', 'de', 0, 'hd1');

describe('loadBlocks', () => {
  it('assembles each parent in wrapper order across mixed types', async () => {
    const items = await loadBlocks(contentField, ['p1'], dialect, 'en');
    deepStrictEqual(items.p1, [
      { block: 'BHero', UUID: 'h1', fields: { title: 'A' } },
      { block: 'BQuote', UUID: 'q1', fields: { words: 'W', cite: null } },
      { block: 'BHero', UUID: 'h2', fields: { title: 'B' } },
    ]);
  });

  it('returns an empty map for no parents and no entry for a parent without rows', async () => {
    deepStrictEqual(await loadBlocks(contentField, [], dialect, 'en'), {});
    const items = await loadBlocks(contentField, ['p2'], dialect, 'en');
    strictEqual(items.p2, undefined);
  });

  it('reads each type present once, batching instances across parents', async () => {
    queries = 0;
    await loadBlocks(contentField, ['p1', 'p3'], dialect, 'en');
    strictEqual(queries, 3);
  });

  it('chunks the wrapper read past 900 parents, keeping every parent whole', async () => {
    const parents = Array.from({ length: 1200 }, (_, index) => `bulk${index}`);
    await post('bulk10', 'Bulk ten');
    await post('bulk950', 'Bulk nine-fifty');
    await hero('bh1', 'Ten');
    await hero('bh2', 'Late');
    await quote('bq1', 'Later', null);
    await place('BPosts_content', 'bw1', 'bulk10', 0, 'BHero', 'bh1');
    await place('BPosts_content', 'bw2', 'bulk950', 1, 'BQuote', 'bq1');
    await place('BPosts_content', 'bw3', 'bulk950', 0, 'BHero', 'bh2');

    queries = 0;
    const items = await loadBlocks(contentField, parents, dialect, 'en');
    strictEqual(queries, 4);
    deepStrictEqual(items.bulk10, [{ block: 'BHero', UUID: 'bh1', fields: { title: 'Ten' } }]);
    deepStrictEqual(items.bulk950, [
      { block: 'BHero', UUID: 'bh2', fields: { title: 'Late' } },
      { block: 'BQuote', UUID: 'bq1', fields: { words: 'Later', cite: null } },
    ]);
  });

  it('hydrates a nested tower: a block holding a repeater holding a blocks field', async () => {
    const items = await loadBlocks(contentField, ['p4'], dialect, 'en');
    deepStrictEqual(items.p4, [
      {
        block: 'BPanel',
        UUID: 'pn1',
        fields: {
          heading: 'H',
          gallery: [
            {
              UUID: 'g1',
              caption: 'C',
              cta: [{ block: 'BQuote', UUID: 'q2', fields: { words: 'W2', cite: 'C2' } }],
            },
          ],
        },
      },
    ]);
  });

  it('reads a translatable blocks field per locale, each list its own', async () => {
    const en = await loadBlocks(bodyField, ['a1'], dialect, 'en');
    deepStrictEqual(en.a1, [{ block: 'BHero', UUID: 'he1', fields: { title: 'EN' } }]);
    const de = await loadBlocks(bodyField, ['a1'], dialect, 'de');
    deepStrictEqual(de.a1, [
      { block: 'BHero', UUID: 'hd1', fields: { title: 'DE' } },
      { block: 'BHero', UUID: 'hd2', fields: { title: 'DE2' } },
    ]);
  });

  it('throws on a dangling instance reference, naming the wrapper table and row', async () => {
    await rejects(loadBlocks(contentField, ['p5'], dialect, 'en'), (error: unknown) => {
      ok(isOhneError(error));
      strictEqual(error.title, 'Dangling block reference in `BPosts_content`');
      const body = Array.isArray(error.body) ? error.body.join('\n') : (error.body ?? '');
      match(body, /`w9`/);
      match(body, /`BHero`/);
      match(body, /`missing`/);
      match(body, /`block_BHero`/);
      return true;
    });
  });
});

describe('blocks through the read spine', () => {
  it('assembles the full record with its envelope list, empty as []', async () => {
    const record = await queryUntyped('BPosts').where({ title: 'First' }).findFirst();
    deepStrictEqual(record, {
      UUID: 'p1',
      _updatedAt: TS,
      title: 'First',
      content: [
        { block: 'BHero', UUID: 'h1', fields: { title: 'A' } },
        { block: 'BQuote', UUID: 'q1', fields: { words: 'W', cite: null } },
        { block: 'BHero', UUID: 'h2', fields: { title: 'B' } },
      ],
    });
    const empty = await queryUntyped('BPosts').where({ title: 'Second' }).findFirst();
    deepStrictEqual(empty?.content, []);
  });

  it('runs no wrapper read for an unselected blocks field', async () => {
    queries = 0;
    await queryUntyped('BPosts').where({ title: 'First' }).select('title').findMany();
    strictEqual(queries, 1);

    queries = 0;
    await queryUntyped('BPosts').where({ title: 'First' }).select('title', 'content').findMany();
    strictEqual(queries, 4);
  });
});
