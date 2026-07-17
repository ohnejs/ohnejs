import { deepStrictEqual, ok, strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import type { DatabaseAdapter } from '../../../../src/ohne/database/adapter.ts';

import { useCollections } from '../../../../src/ohne/collections/use-collections.ts';
import { SQLiteDialect } from '../../../../src/ohne/database/dialects/sqlite/dialect.ts';
import { buildDesiredSchema } from '../../../../src/ohne/database/schema/desired.ts';
import { syncDatabase } from '../../../../src/ohne/database/schema/sync.ts';
import { registerDatabase, registerDialect } from '../../../../src/ohne/database/use-database.ts';
import { field } from '../../../../src/ohne/fields/field.ts';
import { useFields } from '../../../../src/ohne/fields/use-fields.ts';
import { queryMetadata } from '../../../../src/ohne/query/metadata.ts';
import { queryUntyped } from '../../../../src/ohne/query/query.ts';

useCollections().register('CXAccount', {
  name: 'CXAccount',
  collection: {
    fields: {
      email: field('text'),
      tenantId: field('text', { nullable: true }),
      note: field('text', { nullable: true }),
    },
    compositeIndexes: [{ fields: ['email', 'tenantId'], unique: true }, { fields: ['note'] }],
  },
});

const dialect = new SQLiteDialect();
const db = await dialect.connect(':memory:');
registerDialect(dialect);
registerDatabase(db);
await syncDatabase(db, dialect, {
  desired: buildDesiredSchema(useCollections(), useFields() as never),
});

/**
 * Creates an account and returns its re-read record, asserting the write succeeded.
 */
async function seed(over: Record<string, unknown>): Promise<Record<string, unknown>> {
  const result = await queryUntyped('CXAccount').create({ email: 'seed', ...over });
  ok(result.ok);
  return result.record as Record<string, unknown>;
}

/**
 * Runs `fn` while counting the main-table writes it issues that match `pattern`, and returns both.
 * A precheck that rejects before the write leaves the count at zero; a driver-caught collision writes first.
 */
async function withWriteCount<T>(
  pattern: RegExp,
  fn: () => Promise<T>,
): Promise<{ result: T; writes: number }> {
  const adapter = db as DatabaseAdapter;
  const original = adapter.run.bind(adapter);
  let writes = 0;
  adapter.run = (sql, params) => {
    if (pattern.test(sql)) writes++;
    return original(sql, params);
  };
  try {
    return { result: await fn(), writes };
  } finally {
    adapter.run = original;
  }
}

describe('composite unique on create', () => {
  it('rejects a duplicate combination at every covered field, before any insert', async () => {
    const first = await queryUntyped('CXAccount').create({ email: 'a@x', tenantId: 't1' });
    ok(first.ok);
    const { result: second, writes } = await withWriteCount(/INSERT INTO "CXAccount"/, () =>
      queryUntyped('CXAccount').create({ email: 'a@x', tenantId: 't1' }),
    );
    ok(!second.ok);
    deepStrictEqual(second.errors, {
      email: 'validation.notUnique',
      tenantId: 'validation.notUnique',
    });
    strictEqual(writes, 0);
  });

  it('allows a repeated value when the combination differs', async () => {
    const sameEmail = await queryUntyped('CXAccount').create({ email: 'a@x', tenantId: 't2' });
    ok(sameEmail.ok);
    const sameTenant = await queryUntyped('CXAccount').create({ email: 'b@x', tenantId: 't1' });
    ok(sameTenant.ok);
  });

  it('never collides when a covered value is null', async () => {
    const first = await queryUntyped('CXAccount').create({ email: 'n@x', tenantId: null });
    ok(first.ok);
    const second = await queryUntyped('CXAccount').create({ email: 'n@x', tenantId: null });
    ok(second.ok);
  });

  it('leaves a non-unique composite index unchecked', async () => {
    const first = await queryUntyped('CXAccount').create({ email: 'p@x', note: 'shared' });
    ok(first.ok);
    const second = await queryUntyped('CXAccount').create({ email: 'q@x', note: 'shared' });
    ok(second.ok);
  });
});

describe('composite unique on update', () => {
  it('rejects a full-set update that lands on another combination, before any write', async () => {
    const a = await seed({ email: 'u1', tenantId: 'ta' });
    await seed({ email: 'u2', tenantId: 'tb' });
    const { result: clash, writes } = await withWriteCount(/UPDATE "CXAccount"/, () =>
      queryUntyped('CXAccount').where({ UUID: a.UUID }).update({ email: 'u2', tenantId: 'tb' }),
    );
    ok(!clash.ok);
    deepStrictEqual(clash.errors, {
      email: 'validation.notUnique',
      tenantId: 'validation.notUnique',
    });
    strictEqual(writes, 0);
  });

  it('excludes the record itself, so keeping its own combination succeeds', async () => {
    const a = await seed({ email: 'self', tenantId: 'ts' });
    const kept = await queryUntyped('CXAccount')
      .where({ UUID: a.UUID })
      .update({ email: 'self', tenantId: 'ts' });
    ok(kept.ok);
    strictEqual(kept.records.length, 1);
  });

  it('leaves a partial update to the constraint, which the race fallback names', async () => {
    await seed({ email: 'c', tenantId: 'g' });
    const d = await seed({ email: 'd', tenantId: 'g' });
    const { result: clash, writes } = await withWriteCount(/UPDATE "CXAccount"/, () =>
      queryUntyped('CXAccount').where({ UUID: d.UUID }).update({ email: 'c' }),
    );
    ok(!clash.ok);
    deepStrictEqual(clash.errors, {
      email: 'validation.notUnique',
      tenantId: 'validation.notUnique',
    });
    ok(writes >= 1);
    const row = await db.queryOne<{ email: string }>(
      'SELECT "email" FROM "CXAccount" WHERE "UUID" = ?',
      [d.UUID as string],
    );
    strictEqual(row!.email, 'd');
  });
});

describe('composite unique metadata', () => {
  it('resolves only unique composites, onto the main table', () => {
    deepStrictEqual(queryMetadata('CXAccount').compositeUniques, [
      { fields: ['email', 'tenantId'], companion: false },
    ]);
  });
});
