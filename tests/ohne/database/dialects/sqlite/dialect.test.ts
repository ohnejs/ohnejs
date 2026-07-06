import { deepStrictEqual, ok, rejects, strictEqual } from 'node:assert';
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';

import type { DatabaseAdapter } from '../../../../../src/ohne/database/adapter.ts';

import { SQLiteDialect } from '../../../../../src/ohne/database/dialects/sqlite/dialect.ts';
import { sleep } from '../../../../../src/utils/index.ts';

const dialect = new SQLiteDialect();

const nullObj = <T extends object>(o: T): T => Object.assign(Object.create(null), o);

function open(): Promise<DatabaseAdapter> {
  return dialect.connect(':memory:');
}

async function errorOf(promise: Promise<unknown>): Promise<unknown> {
  return promise.then(
    () => undefined,
    (error) => error,
  );
}

describe('SQLiteDialect', () => {
  it('registers under the name `sqlite`', () => {
    strictEqual(dialect.name, 'sqlite');
  });

  it('creates the parent directory for a file path', async () => {
    const root = mkdtempSync(join(tmpdir(), 'ohne-sqlite-'));
    const path = join(root, 'nested', 'app.db');
    const db = await dialect.connect(path);
    await db.exec('CREATE TABLE t (id TEXT PRIMARY KEY)');
    await db.close();
    ok(existsSync(path));
    rmSync(root, { recursive: true, force: true });
  });

  it('connects while another process holds the write lock', async () => {
    const root = mkdtempSync(join(tmpdir(), 'ohne-sqlite-busy-'));
    const path = join(root, 'contended.db');
    const holder = spawn(process.execPath, [
      '-e',
      `const { DatabaseSync } = require('node:sqlite');
       const db = new DatabaseSync(${JSON.stringify(path)});
       db.exec('BEGIN EXCLUSIVE');
       console.log('holding');
       Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 900);
       db.exec('COMMIT');`,
    ]);
    await new Promise<void>((resolve) => holder.stdout.once('data', () => resolve()));
    const db = await dialect.connect(path);
    deepStrictEqual(await db.query('PRAGMA journal_mode'), [nullObj({ journal_mode: 'wal' })]);
    await db.close();
    await new Promise((resolve) => holder.once('exit', resolve));
    rmSync(root, { recursive: true, force: true });
  });

  describe('quote', () => {
    it('wraps in double quotes', () => {
      strictEqual(dialect.quote('Posts'), '"Posts"');
    });

    it('doubles an embedded quote', () => {
      strictEqual(dialect.quote('we"ird'), '"we""ird"');
    });
  });

  describe('columnType', () => {
    it('maps each logical type to a SQLite type', () => {
      strictEqual(dialect.columnType('text'), 'TEXT');
      strictEqual(dialect.columnType('json'), 'TEXT');
      strictEqual(dialect.columnType('integer'), 'INTEGER');
      strictEqual(dialect.columnType('boolean'), 'INTEGER');
    });
  });

  describe('codec', () => {
    it('round-trips a boolean through 1/0', () => {
      strictEqual(dialect.serialize('boolean', true), 1);
      strictEqual(dialect.serialize('boolean', false), 0);
      strictEqual(dialect.deserialize('boolean', 1), true);
      strictEqual(dialect.deserialize('boolean', 0), false);
    });

    it('round-trips JSON through text', () => {
      const value = { a: 1, b: ['x', 'y'] };
      const stored = dialect.serialize('json', value);
      strictEqual(stored, '{"a":1,"b":["x","y"]}');
      deepStrictEqual(dialect.deserialize('json', stored as string), value);
    });

    it('passes text and integer through unchanged', () => {
      strictEqual(dialect.serialize('text', 'hi'), 'hi');
      strictEqual(dialect.serialize('integer', 42), 42);
      strictEqual(dialect.deserialize('text', 'hi'), 'hi');
      strictEqual(dialect.deserialize('integer', 42), 42);
    });

    it('codes null and undefined to NULL, and NULL back to null', () => {
      strictEqual(dialect.serialize('text', null), null);
      strictEqual(dialect.serialize('json', undefined), null);
      strictEqual(dialect.serialize('boolean', null), null);
      strictEqual(dialect.deserialize('boolean', null), null);
      strictEqual(dialect.deserialize('json', null), null);
    });
  });

  describe('adapter', () => {
    it('runs statements and reads rows back', async () => {
      const db = await open();
      await db.exec('CREATE TABLE t (id TEXT PRIMARY KEY, n INTEGER)');
      const { changes } = await db.run('INSERT INTO t (id, n) VALUES (?, ?)', ['a', 1]);
      strictEqual(changes, 1);
      deepStrictEqual(await db.query('SELECT id, n FROM t'), [nullObj({ id: 'a', n: 1 })]);
      deepStrictEqual(
        await db.queryOne('SELECT id, n FROM t WHERE id = ?', ['a']),
        nullObj({ id: 'a', n: 1 }),
      );
      strictEqual(await db.queryOne('SELECT id FROM t WHERE id = ?', ['missing']), undefined);
      await db.close();
    });

    it('reports the number of rows a write changed', async () => {
      const db = await open();
      await db.exec('CREATE TABLE t (id TEXT PRIMARY KEY)');
      await db.run('INSERT INTO t (id) VALUES (?)', ['a']);
      await db.run('INSERT INTO t (id) VALUES (?)', ['b']);
      strictEqual((await db.run('DELETE FROM t')).changes, 2);
      await db.close();
    });

    it('enforces foreign keys, since the pragma is applied', async () => {
      const db = await open();
      await db.exec('CREATE TABLE parent (id TEXT PRIMARY KEY)');
      await db.exec('CREATE TABLE child (id TEXT PRIMARY KEY, pid TEXT REFERENCES parent(id))');
      await rejects(() => db.run('INSERT INTO child (id, pid) VALUES (?, ?)', ['c', 'missing']));
      await db.close();
    });
  });

  describe('transaction', () => {
    it('commits when fn returns', async () => {
      const db = await open();
      await db.exec('CREATE TABLE t (id TEXT PRIMARY KEY)');
      const result = await db.transaction(async (tx) => {
        await tx.run('INSERT INTO t (id) VALUES (?)', ['a']);
        return 'done';
      });
      strictEqual(result, 'done');
      deepStrictEqual(await db.query('SELECT id FROM t'), [nullObj({ id: 'a' })]);
      await db.close();
    });

    it('rolls back when fn throws, then rethrows', async () => {
      const db = await open();
      await db.exec('CREATE TABLE t (id TEXT PRIMARY KEY)');
      await db.run('INSERT INTO t (id) VALUES (?)', ['a']);
      await rejects(
        db.transaction(async (tx) => {
          await tx.run('INSERT INTO t (id) VALUES (?)', ['b']);
          throw new Error('boom');
        }),
        /boom/,
      );
      deepStrictEqual(await db.query('SELECT id FROM t'), [nullObj({ id: 'a' })]);
      await db.close();
    });
  });

  describe('schemaTransaction', () => {
    it('commits DDL and DML together and returns the result', async () => {
      const db = await open();
      const result = await dialect.schemaTransaction(db, async (tx) => {
        await tx.exec('CREATE TABLE t (id TEXT PRIMARY KEY)');
        await tx.run('INSERT INTO t (id) VALUES (?)', ['a']);
        return 'done';
      });
      strictEqual(result, 'done');
      deepStrictEqual(await db.query('SELECT id FROM t'), [nullObj({ id: 'a' })]);
      await db.close();
    });

    it('rolls back DDL atomically when fn throws, then rethrows', async () => {
      const db = await open();
      await rejects(
        dialect.schemaTransaction(db, async (tx) => {
          await tx.exec('CREATE TABLE t (id TEXT PRIMARY KEY)');
          throw new Error('boom');
        }),
        /boom/,
      );
      deepStrictEqual(await dialect.listTables(db), []);
      await db.close();
    });

    it('turns foreign-key enforcement off inside and back on after commit', async () => {
      const db = await open();
      await db.exec('CREATE TABLE parent (id TEXT PRIMARY KEY)');
      await db.exec('CREATE TABLE child (id TEXT PRIMARY KEY, pid TEXT REFERENCES parent(id))');
      await dialect.schemaTransaction(db, async (tx) => {
        await tx.run('INSERT INTO child (id, pid) VALUES (?, ?)', ['c', 'missing']);
        await tx.run('DELETE FROM child');
      });
      deepStrictEqual(await db.query('PRAGMA foreign_keys'), [nullObj({ foreign_keys: 1 })]);
      await rejects(db.run('INSERT INTO child (id, pid) VALUES (?, ?)', ['c', 'missing']));
      await db.close();
    });

    it('restores foreign-key enforcement after a rollback', async () => {
      const db = await open();
      await rejects(
        dialect.schemaTransaction(db, async () => {
          throw new Error('boom');
        }),
        /boom/,
      );
      deepStrictEqual(await db.query('PRAGMA foreign_keys'), [nullObj({ foreign_keys: 1 })]);
      await db.close();
    });
  });

  describe('renameTable', () => {
    it('renames a table, keeping its rows', async () => {
      const db = await open();
      await db.exec('CREATE TABLE "Posts" (id TEXT PRIMARY KEY)');
      await db.run('INSERT INTO "Posts" (id) VALUES (?)', ['a']);
      await dialect.renameTable(db, 'Posts', 'Articles');
      deepStrictEqual(await dialect.listTables(db), ['Articles']);
      deepStrictEqual(await db.query('SELECT id FROM "Articles"'), [nullObj({ id: 'a' })]);
      await db.close();
    });

    it('rewrites other tables` foreign keys to follow the new name', async () => {
      const db = await open();
      await db.exec('CREATE TABLE "Posts" (id TEXT PRIMARY KEY)');
      await db.exec(
        'CREATE TABLE "Comments" (id TEXT PRIMARY KEY, post TEXT REFERENCES "Posts"(id))',
      );
      await dialect.renameTable(db, 'Posts', 'Articles');
      const schema = await dialect.describeTable(db, 'Comments');
      strictEqual(schema.foreignKeys[0]?.targetTable, 'Articles');
      await db.close();
    });

    it('hops through an aside name on a case-only rename', async () => {
      const db = await open();
      await db.exec('CREATE TABLE "Posts" (id TEXT PRIMARY KEY)');
      await db.run('INSERT INTO "Posts" (id) VALUES (?)', ['a']);
      await dialect.renameTable(db, 'Posts', 'posts');
      deepStrictEqual(await dialect.listTables(db), ['posts']);
      deepStrictEqual(await db.query('SELECT id FROM "posts"'), [nullObj({ id: 'a' })]);
      await db.close();
    });
  });

  describe('error classification', () => {
    it('recognizes a unique violation, over both a unique index and a primary key', async () => {
      const db = await open();
      await db.exec('CREATE TABLE t (id TEXT PRIMARY KEY, email TEXT UNIQUE)');
      await db.run('INSERT INTO t (id, email) VALUES (?, ?)', ['a', 'x@y.z']);
      const uniqueError = await errorOf(
        db.run('INSERT INTO t (id, email) VALUES (?, ?)', ['b', 'x@y.z']),
      );
      const pkError = await errorOf(
        db.run('INSERT INTO t (id, email) VALUES (?, ?)', ['a', 'w@y.z']),
      );
      ok(dialect.isUniqueViolation(uniqueError));
      ok(dialect.isUniqueViolation(pkError));
      strictEqual(dialect.isForeignKeyViolation(uniqueError), false);
      await db.close();
    });

    it('recognizes a foreign-key violation', async () => {
      const db = await open();
      await db.exec('CREATE TABLE parent (id TEXT PRIMARY KEY)');
      await db.exec('CREATE TABLE child (id TEXT PRIMARY KEY, pid TEXT REFERENCES parent(id))');
      const fkError = await errorOf(
        db.run('INSERT INTO child (id, pid) VALUES (?, ?)', ['c', 'missing']),
      );
      ok(dialect.isForeignKeyViolation(fkError));
      strictEqual(dialect.isUniqueViolation(fkError), false);
      await db.close();
    });

    it('classifies a non-database error as neither', () => {
      strictEqual(dialect.isUniqueViolation(new Error('x')), false);
      strictEqual(dialect.isForeignKeyViolation(undefined), false);
    });

    it('recognizes busy and locked, extended codes folded to primary', () => {
      strictEqual(dialect.isBusy(Object.assign(new Error('locked'), { errcode: 5 })), true);
      strictEqual(dialect.isBusy(Object.assign(new Error('locked'), { errcode: 6 })), true);
      strictEqual(dialect.isBusy(Object.assign(new Error('locked'), { errcode: 517 })), true);
      strictEqual(dialect.isBusy(Object.assign(new Error('fk'), { errcode: 787 })), false);
      strictEqual(dialect.isBusy(new Error('x')), false);
    });
  });

  describe('cluster lock', () => {
    it('grants the lock to one caller and refuses the next', async () => {
      const db = await open();
      const first = await dialect.acquireLock(db, 'sync');
      ok(first);
      strictEqual(await dialect.acquireLock(db, 'sync'), null);
      await db.close();
    });

    it('frees the lock on release, so it can be re-acquired', async () => {
      const db = await open();
      const handle = await dialect.acquireLock(db, 'sync');
      ok(handle);
      await dialect.releaseLock(db, handle);
      ok(await dialect.acquireLock(db, 'sync'));
      await db.close();
    });

    it('ignores a release with a mismatched nonce', async () => {
      const db = await open();
      ok(await dialect.acquireLock(db, 'sync'));
      await dialect.releaseLock(db, { key: 'sync', nonce: 'wrong' });
      strictEqual(await dialect.acquireLock(db, 'sync'), null);
      await db.close();
    });

    it('waitForLock resolves once the holder releases', async () => {
      const db = await open();
      const handle = await dialect.acquireLock(db, 'sync');
      ok(handle);
      const waited = dialect.waitForLock(db, 'sync', { pollInterval: 5, staleAfter: 10_000 });
      await sleep(15);
      await dialect.releaseLock(db, handle);
      await waited;
      ok(await dialect.acquireLock(db, 'sync'));
      await db.close();
    });

    it('waitForLock steals an abandoned lock', async () => {
      const db = await open();
      ok(await dialect.acquireLock(db, 'sync'));
      await db.run('UPDATE "ohne_locks" SET "acquiredAt" = ? WHERE "key" = ?', [
        Date.now() - 10_000,
        'sync',
      ]);
      await dialect.waitForLock(db, 'sync', { pollInterval: 5, staleAfter: 50 });
      ok(await dialect.acquireLock(db, 'sync'));
      await db.close();
    });
  });
});
