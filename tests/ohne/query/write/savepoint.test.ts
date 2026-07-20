import { ok, rejects, strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { useCollections } from '../../../../src/ohne/collections/use-collections.ts';
import { SQLiteDialect } from '../../../../src/ohne/database/dialects/sqlite/dialect.ts';
import { buildDesiredSchema } from '../../../../src/ohne/database/schema/desired.ts';
import { syncDatabase } from '../../../../src/ohne/database/schema/sync.ts';
import {
  registerDatabase,
  registerDialect,
  useDatabase,
} from '../../../../src/ohne/database/use-database.ts';
import { field } from '../../../../src/ohne/fields/field.ts';
import { useFields } from '../../../../src/ohne/fields/use-fields.ts';
import { runCreate } from '../../../../src/ohne/query/write/create.ts';
import { runDelete } from '../../../../src/ohne/query/write/delete.ts';
import { isReferenceViolation } from '../../../../src/ohne/query/write/errors.ts';
import { runUpdate } from '../../../../src/ohne/query/write/update.ts';

useCollections().register('SPDoc', {
  name: 'SPDoc',
  collection: {
    fields: {
      title: field('text', { unique: true }),
      items: field('repeater', {
        fields: {
          mode: field('text'),
          code: field('text', {
            nullable: true,
            unique: true,
            default: 'RESET',
            when: { mode: 'full' },
          }),
        },
      }),
    },
  },
});
useCollections().register('SPHold', {
  name: 'SPHold',
  collection: { fields: { doc: field('record', { collection: 'SPDoc', onDelete: 'restrict' }) } },
});

const dialect = new SQLiteDialect();
const db = await dialect.connect(':memory:');
registerDialect(dialect);
registerDatabase(db);
await syncDatabase(db, dialect, {
  desired: buildDesiredSchema(useCollections(), useFields() as never),
});

function uuidIs(uuid: string) {
  return { kind: 'compare', path: ['UUID'], op: 'equalsTo', value: uuid, negated: false } as const;
}

describe('joined-transaction savepoint', () => {
  it('unwinds a mid-write constraint failure, keeping the caller transaction whole', async () => {
    const holder = await runCreate('SPDoc', { title: 'holder', items: [{ mode: 'lite' }] }, null);
    ok(holder.ok);
    const target = await runCreate(
      'SPDoc',
      { title: 'target', items: [{ mode: 'full', code: 'MINE' }] },
      null,
    );
    ok(target.ok);
    const record = target.record as { UUID: string; items: { UUID: string }[] };

    // Flipping the gate resets `code` to the default `RESET`, which another parent already holds.
    // The reset is not prechecked, so the failure fires mid-write, after the title column landed.
    const kept = await useDatabase().transaction(async (tx) => {
      const created = await runCreate('SPDoc', { title: 'kept', items: [] }, null, tx);
      ok(created.ok);
      const failed = await runUpdate(
        'SPDoc',
        { title: 'changed', items: [{ UUID: record.items[0].UUID, mode: 'lite', code: 'MINE' }] },
        uuidIs(record.UUID),
        null,
        tx,
      );
      ok(!failed.ok);
      strictEqual(failed.errors['items.code'], 'validation.notUnique');
      return created.record as { UUID: string };
    }, 'immediate');

    const keptRow = await db.queryOne<{ title: string }>(
      'SELECT "title" FROM "SPDoc" WHERE "UUID" = ?',
      [kept.UUID],
    );
    strictEqual(keptRow?.title, 'kept');
    const targetRow = await db.queryOne<{ title: string }>(
      'SELECT "title" FROM "SPDoc" WHERE "UUID" = ?',
      [record.UUID],
    );
    strictEqual(targetRow?.title, 'target');
    const item = await db.queryOne<{ code: string; mode: string }>(
      'SELECT "code", "mode" FROM "SPDoc_items" WHERE "UUID" = ?',
      [record.items[0].UUID],
    );
    strictEqual(item?.code, 'MINE');
    strictEqual(item?.mode, 'full');
  });

  it('unwinds a precheck failure and releases, so the caller commits cleanly', async () => {
    const first = await runCreate('SPDoc', { title: 'sp-a', items: [] }, null);
    const second = await runCreate('SPDoc', { title: 'sp-b', items: [] }, null);
    ok(first.ok);
    ok(second.ok);
    const uuid = (second.record as { UUID: string }).UUID;
    await useDatabase().transaction(async (tx) => {
      const failed = await runUpdate('SPDoc', { title: 'sp-a' }, uuidIs(uuid), null, tx);
      ok(!failed.ok);
      strictEqual(failed.errors.title, 'validation.notUnique');
    }, 'immediate');
    const row = await db.queryOne<{ title: string }>(
      'SELECT "title" FROM "SPDoc" WHERE "UUID" = ?',
      [uuid],
    );
    strictEqual(row?.title, 'sp-b');
  });

  it('commits a joined delete with the caller, and a caller rollback restores it', async () => {
    const doomed = await runCreate('SPDoc', { title: 'sp-doomed', items: [] }, null);
    ok(doomed.ok);
    const uuid = (doomed.record as { UUID: string }).UUID;

    await rejects(
      useDatabase().transaction(async (tx) => {
        strictEqual((await runDelete('SPDoc', uuidIs(uuid), tx)).deleted, 1);
        throw new Error('caller rollback');
      }, 'immediate'),
      /caller rollback/,
    );
    const survivor = await db.queryOne<{ title: string }>(
      'SELECT "title" FROM "SPDoc" WHERE "UUID" = ?',
      [uuid],
    );
    strictEqual(survivor?.title, 'sp-doomed');

    await useDatabase().transaction(async (tx) => {
      strictEqual((await runDelete('SPDoc', uuidIs(uuid), tx)).deleted, 1);
    }, 'immediate');
    strictEqual(await db.queryOne('SELECT 1 FROM "SPDoc" WHERE "UUID" = ?', [uuid]), undefined);
  });

  it('unwinds a restrict-blocked joined delete, and the caller still commits', async () => {
    const held = await runCreate('SPDoc', { title: 'sp-held', items: [] }, null);
    ok(held.ok);
    const uuid = (held.record as { UUID: string }).UUID;
    const holder = await runCreate('SPHold', { doc: uuid }, null);
    ok(holder.ok);

    const kept = await useDatabase().transaction(async (tx) => {
      const created = await runCreate('SPDoc', { title: 'sp-outlives', items: [] }, null, tx);
      ok(created.ok);
      await rejects(() => runDelete('SPDoc', uuidIs(uuid), tx), isReferenceViolation);
      return created.record as { UUID: string };
    }, 'immediate');

    const heldRow = await db.queryOne<{ title: string }>(
      'SELECT "title" FROM "SPDoc" WHERE "UUID" = ?',
      [uuid],
    );
    strictEqual(heldRow?.title, 'sp-held');
    const keptRow = await db.queryOne<{ title: string }>(
      'SELECT "title" FROM "SPDoc" WHERE "UUID" = ?',
      [kept.UUID],
    );
    strictEqual(keptRow?.title, 'sp-outlives');
  });
});
