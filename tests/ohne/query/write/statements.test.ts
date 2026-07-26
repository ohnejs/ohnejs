import { ok, strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import type { DatabaseAdapter, Transaction } from '../../../../src/ohne/database/adapter.ts';

import { useBlocks } from '../../../../src/ohne/blocks/use-blocks.ts';
import { useCollections } from '../../../../src/ohne/collections/use-collections.ts';
import { SQLiteDialect } from '../../../../src/ohne/database/dialects/sqlite/dialect.ts';
import { buildDesiredSchema } from '../../../../src/ohne/database/schema/desired.ts';
import { syncDatabase } from '../../../../src/ohne/database/schema/sync.ts';
import { registerDatabase, registerDialect } from '../../../../src/ohne/database/use-database.ts';
import { field } from '../../../../src/ohne/fields/field.ts';
import { useFields } from '../../../../src/ohne/fields/use-fields.ts';
import { queryUntyped } from '../../../../src/ohne/query/query.ts';

useBlocks().register('STHero', { name: 'STHero', block: { fields: { title: field('text') } } });

useCollections().register('STTag', {
  name: 'STTag',
  collection: { fields: { label: field('text') } },
});

useCollections().register('STPost', {
  name: 'STPost',
  collection: {
    fields: {
      title: field('text'),
      tags: field('records', { collection: 'STTag' }),
      items: field('repeater', { fields: { name: field('text'), qty: field('integer') } }),
      body: field('blocks', { allow: ['STHero'] }),
      meta: field('object', {
        fields: {
          note: field('text'),
          links: field('repeater', { fields: { label: field('text') } }),
        },
      }),
    },
  },
});

const dialect = new SQLiteDialect();
const db = await dialect.connect(':memory:');
registerDialect(dialect);
registerDatabase(db);
await syncDatabase(db, dialect, {
  desired: buildDesiredSchema(useCollections(), useFields() as never, useBlocks()),
});

const statements: string[] = [];
let counting = false;

/**
 * Wraps a transaction so every statement it issues lands in `statements` while a count is running.
 */
function counted(tx: Transaction): Transaction {
  const record = (sql: string): void => {
    if (counting) statements.push(sql);
  };
  return {
    exec: (sql) => {
      record(sql);
      return tx.exec(sql);
    },
    run: (sql, params) => {
      record(sql);
      return tx.run(sql, params as never);
    },
    query: (sql, params) => {
      record(sql);
      return tx.query(sql, params as never) as never;
    },
    queryOne: (sql, params) => {
      record(sql);
      return tx.queryOne(sql, params as never) as never;
    },
  } as Transaction;
}

registerDatabase({
  ...counted(db),
  transaction: (fn, mode) => db.transaction((tx) => fn(counted(tx)), mode),
  close: () => db.close(),
} as DatabaseAdapter);

/**
 * Runs `fn` and returns the statements it issued, `VALUES` tuples folded so shapes compare stably.
 */
async function statementsOf(fn: () => Promise<unknown>): Promise<string[]> {
  statements.length = 0;
  counting = true;
  try {
    await fn();
  } finally {
    counting = false;
  }
  return [...statements];
}

/**
 * The statements touching `table`, filtered by verb, so a pin reads one derived table at a time.
 */
function touching(all: readonly string[], table: string, verb?: string): string[] {
  return all.filter(
    (sql) => sql.includes(`"${table}"`) && (verb === undefined || sql.startsWith(verb)),
  );
}

const M = 10;
const K = 8;

describe('write statement batching', () => {
  it('a create batches its repeater items into one multi-row insert', async () => {
    const all = await statementsOf(async () => {
      const result = await queryUntyped('STPost').create({
        title: 'batch-create',
        items: Array.from({ length: 50 }, (_, i) => ({ name: `i${i}`, qty: i })),
      });
      ok(result.ok);
    });
    strictEqual(touching(all, 'STPost_items', 'INSERT').length, 1);
    strictEqual(touching(all, 'STPost', 'INSERT').length, 1);
  });

  it('a create batches block instances per type and wrappers into one insert each', async () => {
    const all = await statementsOf(async () => {
      const result = await queryUntyped('STPost').create({
        title: 'batch-blocks',
        body: Array.from({ length: 30 }, (_, i) => ({
          block: 'STHero',
          fields: { title: `h${i}` },
        })),
      });
      ok(result.ok);
    });
    strictEqual(touching(all, 'block_STHero', 'INSERT').length, 1);
    strictEqual(touching(all, 'STPost_body', 'INSERT').length, 1);
  });

  it('a bulk update rewrites every record`s repeater items in three derived statements', async () => {
    for (let m = 0; m < M; m++) {
      const result = await queryUntyped('STPost').create({
        title: 'bulk',
        items: Array.from({ length: K }, (_, i) => ({ name: `i${m}-${i}`, qty: i })),
      });
      ok(result.ok);
    }
    const all = await statementsOf(async () => {
      const result = await queryUntyped('STPost')
        .where({ title: 'bulk' })
        .update({ items: Array.from({ length: K }, (_, i) => ({ name: `n${i}`, qty: i })) });
      ok(result.ok);
      strictEqual(result.records.length, M);
    });
    const derived = touching(all, 'STPost_items');
    strictEqual(derived.filter((sql) => sql.startsWith('SELECT')).length, 2);
    strictEqual(derived.filter((sql) => sql.startsWith('DELETE')).length, 1);
    strictEqual(derived.filter((sql) => sql.startsWith('INSERT')).length, 1);
  });

  it('a bulk update reaches nested composites with reads constant in M', async () => {
    const result = await queryUntyped('STPost')
      .where({ title: 'bulk' })
      .update({ meta: { note: 'n', links: [{ label: 'l' }] } });
    ok(result.ok);
    const all = await statementsOf(async () => {
      const again = await queryUntyped('STPost')
        .where({ title: 'bulk' })
        .update({ meta: { note: 'n2', links: [{ label: 'l2' }] } });
      ok(again.ok);
      strictEqual(again.records.length, M);
    });
    strictEqual(touching(all, 'STPost_meta', 'SELECT').length, 2);
    strictEqual(touching(all, 'STPost_meta', 'UPDATE').length, 1);
    strictEqual(touching(all, 'STPost_meta_links', 'SELECT').length, 2);
    strictEqual(touching(all, 'STPost_meta_links', 'DELETE').length, 1);
    strictEqual(touching(all, 'STPost_meta_links', 'INSERT').length, 1);
  });

  it('a bulk update replacing blocks batches instances, wrappers, and cleanup', async () => {
    const seeded = await queryUntyped('STPost')
      .where({ title: 'bulk' })
      .update({
        body: Array.from({ length: 5 }, (_, i) => ({
          block: 'STHero',
          fields: { title: `h${i}` },
        })),
      });
    ok(seeded.ok);
    const all = await statementsOf(async () => {
      const result = await queryUntyped('STPost')
        .where({ title: 'bulk' })
        .update({
          body: Array.from({ length: 5 }, (_, i) => ({
            block: 'STHero',
            fields: { title: `n${i}` },
          })),
        });
      ok(result.ok);
    });
    strictEqual(touching(all, 'STPost_body', 'DELETE').length, 1);
    strictEqual(touching(all, 'STPost_body', 'INSERT').length, 1);
    strictEqual(touching(all, 'block_STHero', 'DELETE').length, 1);
    strictEqual(touching(all, 'block_STHero', 'INSERT').length, 1);
  });

  it('a bulk update with an unchanged junction list reads once and writes nothing', async () => {
    const tags: string[] = [];
    for (let i = 0; i < 5; i++) {
      const tag = await queryUntyped('STTag').create({ label: `t${i}` });
      ok(tag.ok);
      tags.push(tag.record.UUID as string);
    }
    const linked = await queryUntyped('STPost').where({ title: 'bulk' }).update({ tags });
    ok(linked.ok);
    const all = await statementsOf(async () => {
      const result = await queryUntyped('STPost').where({ title: 'bulk' }).update({ tags });
      ok(result.ok);
    });
    const junction = touching(all, 'STPost_tags');
    strictEqual(junction.filter((sql) => !sql.startsWith('SELECT')).length, 0);
    strictEqual(junction.filter((sql) => sql.includes('"_parentPosition" AS "pos"')).length, 1);
  });
});
