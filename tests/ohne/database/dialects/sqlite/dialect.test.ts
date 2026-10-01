import { deepStrictEqual, ok, rejects, strictEqual } from 'node:assert';
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';

import type { DatabaseAdapter } from '../../../../../src/ohne/database/adapter.ts';

import { SQLiteDialect } from '../../../../../src/ohne/database/dialects/sqlite/dialect.ts';
import { escapeLike } from '../../../../../src/ohne/query/sql/escape-like.ts';
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

async function fillUp(db: DatabaseAdapter): Promise<void> {
  await db.exec('CREATE TABLE t (v TEXT)');
  const [{ page_count }] = await db.query<{ page_count: number }>('PRAGMA page_count');
  await db.exec(`PRAGMA max_page_count = ${page_count}`);
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

  describe('transaction', () => {
    it('commits its writes and returns the result', async () => {
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

    it('rolls back every write on a throw and re-throws', async () => {
      const db = await open();
      await db.exec('CREATE TABLE t (id TEXT PRIMARY KEY)');
      await rejects(
        db.transaction(async (tx) => {
          await tx.run('INSERT INTO t (id) VALUES (?)', ['a']);
          throw new Error('boom');
        }),
        /boom/,
      );
      deepStrictEqual(await db.query('SELECT id FROM t'), []);
      await db.close();
    });

    it('serializes overlapping transactions on one connection', async () => {
      const db = await open();
      await db.exec('CREATE TABLE t (id TEXT PRIMARY KEY)');
      const write = (a: string, b: string) =>
        db.transaction(async (tx) => {
          await tx.run('INSERT INTO t (id) VALUES (?)', [a]);
          await Promise.resolve();
          await tx.run('INSERT INTO t (id) VALUES (?)', [b]);
        });
      await Promise.all([write('a', 'b'), write('c', 'd')]);
      const ids = (await db.query<{ id: string }>('SELECT id FROM t ORDER BY id')).map((r) => r.id);
      deepStrictEqual(ids, ['a', 'b', 'c', 'd']);
      await db.close();
    });

    it('opens `immediate` and commits', async () => {
      const db = await open();
      await db.exec('CREATE TABLE t (id TEXT PRIMARY KEY)');
      await db.transaction(async (tx) => {
        await tx.run('INSERT INTO t (id) VALUES (?)', ['a']);
      }, 'immediate');
      deepStrictEqual(await db.query('SELECT id FROM t'), [nullObj({ id: 'a' })]);
      await db.close();
    });

    const INSERT = 'INSERT INTO t (name) VALUES (?)';

    async function openHeroes(): Promise<DatabaseAdapter> {
      const db = await open();
      await db.exec('CREATE TABLE t (name TEXT)');
      return db;
    }

    async function heroes(db: DatabaseAdapter): Promise<string[]> {
      const rows = await db.query<{ name: string }>('SELECT name FROM t ORDER BY rowid');
      return rows.map((row) => row.name);
    }

    async function holdOpen(
      db: DatabaseAdapter,
      name: string,
    ): Promise<(outcome: 'commit' | 'rollback') => Promise<void>> {
      const gate = Promise.withResolvers<'commit' | 'rollback'>();
      const entered = Promise.withResolvers<void>();
      const held = db.transaction(async (tx) => {
        await tx.run(INSERT, [name]);
        entered.resolve();
        if ((await gate.promise) === 'rollback') throw new Error('rolled back');
      });
      await entered.promise;
      return (outcome) => {
        gate.resolve(outcome);
        return outcome === 'rollback' ? rejects(held, /rolled back/) : held;
      };
    }

    it('keeps a write from another flow out of an open transaction that rolls back', async () => {
      const db = await openHeroes();
      const settle = await holdOpen(db, 'arthas');
      const write = db.run(INSERT, ['jaina']);
      await settle('rollback');
      await write;
      deepStrictEqual(await heroes(db), ['jaina']);
      await db.close();
    });

    it('hides the rows of an open transaction from a read in another flow', async () => {
      const db = await openHeroes();
      const settle = await holdOpen(db, 'arthas');
      const read = heroes(db);
      await settle('rollback');
      deepStrictEqual(await read, []);
      await db.close();
    });

    it("keeps a lock taken from another flow through an open transaction's rollback", async () => {
      const db = await openHeroes();
      const settle = await holdOpen(db, 'arthas');
      const acquired = dialect.acquireLock(db, 'uploads:session:jaina');
      await settle('rollback');
      ok(await acquired);
      strictEqual(await dialect.acquireLock(db, 'uploads:session:jaina'), null);
      await db.close();
    });

    it("keeps a lock released from another flow free through an open transaction's rollback", async () => {
      const db = await openHeroes();
      const handle = await dialect.acquireLock(db, 'uploads:session:jaina');
      ok(handle);
      const settle = await holdOpen(db, 'arthas');
      const released = dialect.releaseLock(db, handle);
      await settle('rollback');
      await released;
      ok(await dialect.acquireLock(db, 'uploads:session:jaina'));
      await db.close();
    });

    it('queues statements from other flows in order with transactions, behind the open one', async () => {
      const db = await openHeroes();
      const gate = Promise.withResolvers<void>();
      const entered = Promise.withResolvers<void>();
      const first = db.transaction(async (tx) => {
        await tx.run(INSERT, ['arthas']);
        entered.resolve();
        await gate.promise;
        await tx.run(INSERT, ['illidan']);
      });
      await entered.promise;
      const queued = [
        db.run(INSERT, ['jaina']),
        db.transaction((tx) => tx.run(INSERT, ['thrall'])),
        ...['sylvanas', 'uther', 'tyrande'].map((name) => db.run(INSERT, [name])),
      ];
      gate.resolve();
      await Promise.all([first, ...queued]);
      deepStrictEqual(await heroes(db), [
        'arthas',
        'illidan',
        'jaina',
        'thrall',
        'sylvanas',
        'uther',
        'tyrande',
      ]);
      await db.close();
    });

    it('keeps the queue moving past a waiting statement that fails', async () => {
      const db = await openHeroes();
      const settle = await holdOpen(db, 'arthas');
      const failed = rejects(
        db.run('INSERT INTO missing (name) VALUES (?)', ['jaina']),
        /no such table/,
      );
      const write = db.run(INSERT, ['thrall']);
      await settle('commit');
      await failed;
      await write;
      deepStrictEqual(await heroes(db), ['arthas', 'thrall']);
      await db.close();
    });

    it('runs its own flow at once, through the adapter and in work it started', async () => {
      const db = await openHeroes();
      await rejects(
        db.transaction(async () => {
          const started = sleep(1).then(() => db.run(INSERT, ['arthas']));
          await db.run(INSERT, ['jaina']);
          await started;
          throw new Error('rolled back');
        }),
        /rolled back/,
      );
      deepStrictEqual(await heroes(db), []);
      await db.close();
    });

    it('runs work a settled transaction left behind outside the next one', async () => {
      const db = await openHeroes();
      const later = Promise.withResolvers<void>();
      let leftover!: Promise<unknown>;
      await db.transaction(async (tx) => {
        leftover = later.promise.then(() => db.run(INSERT, ['thrall']));
        await tx.run(INSERT, ['jaina']);
      });
      const settle = await holdOpen(db, 'arthas');
      later.resolve();
      await sleep(1);
      await settle('rollback');
      await leftover;
      deepStrictEqual(await heroes(db), ['jaina', 'thrall']);
      await db.close();
    });

    it('runs a transaction started inside another, unawaited, once the outer commits', async () => {
      const db = await openHeroes();
      let inner!: Promise<unknown>;
      await db.transaction(async (tx) => {
        inner = db.transaction((nested) => nested.run(INSERT, ['jaina']));
        await tx.run(INSERT, ['arthas']);
      });
      await inner;
      deepStrictEqual(await heroes(db), ['arthas', 'jaina']);
      await db.close();
    });
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
      strictEqual(dialect.columnType('real'), 'REAL');
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

    it('passes text, integer, and real through unchanged', () => {
      strictEqual(dialect.serialize('text', 'hi'), 'hi');
      strictEqual(dialect.serialize('integer', 42), 42);
      strictEqual(dialect.serialize('real', 1.5), 1.5);
      strictEqual(dialect.deserialize('text', 'hi'), 'hi');
      strictEqual(dialect.deserialize('integer', 42), 42);
      strictEqual(dialect.deserialize('real', 1.5), 1.5);
    });

    it('codes null and undefined to NULL, and NULL back to null', () => {
      strictEqual(dialect.serialize('text', null), null);
      strictEqual(dialect.serialize('json', undefined), null);
      strictEqual(dialect.serialize('boolean', null), null);
      strictEqual(dialect.deserialize('boolean', null), null);
      strictEqual(dialect.deserialize('json', null), null);
    });
  });

  describe('textMatch', () => {
    async function seed(names: string[]): Promise<DatabaseAdapter> {
      const db = await open();
      await db.exec('CREATE TABLE t (name TEXT)');
      for (const name of names) await db.run('INSERT INTO t (name) VALUES (?)', [name]);
      return db;
    }

    function match(
      db: DatabaseAdapter,
      pattern: string,
      fold = false,
    ): Promise<{ name: string }[]> {
      const where = dialect.textMatch('"name"', fold);
      return db.query(`SELECT name FROM t WHERE ${where} ORDER BY name`, [pattern]);
    }

    it('emits LIKE with a backslash escape and one placeholder', () => {
      strictEqual(dialect.textMatch('"name"', false), `"name" LIKE ? ESCAPE '\\'`);
    });

    it('folds the column through `ohne_lower` when asked', () => {
      strictEqual(dialect.textMatch('"name"', true), `ohne_lower("name") LIKE ? ESCAPE '\\'`);
    });

    it('a folded match finds non-ASCII text by its lowercased pattern', async () => {
      const db = await seed(['Émile Zola', 'ΣΟΦΙΑ', 'Привет мир', 'emile']);
      deepStrictEqual(await match(db, '%émile%', true), [nullObj({ name: 'Émile Zola' })]);
      deepStrictEqual(await match(db, 'σοφια', true), [nullObj({ name: 'ΣΟΦΙΑ' })]);
      deepStrictEqual(await match(db, '%привет%', true), [nullObj({ name: 'Привет мир' })]);
      deepStrictEqual(await match(db, '%émile%'), []);
      await db.close();
    });

    it('a folded match reads a final sigma as a medial one', async () => {
      const db = await seed(['ΣΟΦΙΑΣΜΟΣ']);
      deepStrictEqual(await match(db, '%σοφιασ%', true), [nullObj({ name: 'ΣΟΦΙΑΣΜΟΣ' })]);
      await db.close();
    });

    it('matches case-insensitively', async () => {
      const db = await seed(['Hello World', 'goodbye']);
      deepStrictEqual(await match(db, `%${escapeLike('HELLO')}%`), [
        nullObj({ name: 'Hello World' }),
      ]);
      await db.close();
    });

    it('matches an escaped `%` literally while a raw `%` wildcards', async () => {
      const db = await seed(['100%', '100x']);
      deepStrictEqual(await match(db, '100%'), [
        nullObj({ name: '100%' }),
        nullObj({ name: '100x' }),
      ]);
      deepStrictEqual(await match(db, escapeLike('100%')), [nullObj({ name: '100%' })]);
      await db.close();
    });

    it('matches an escaped `_` literally while a raw `_` wildcards', async () => {
      const db = await seed(['a_b', 'axb']);
      deepStrictEqual(await match(db, 'a_b'), [nullObj({ name: 'a_b' }), nullObj({ name: 'axb' })]);
      deepStrictEqual(await match(db, escapeLike('a_b')), [nullObj({ name: 'a_b' })]);
      await db.close();
    });

    it('round-trips a backslash', async () => {
      const db = await seed(['C:\\dir\\file', 'C:dir']);
      deepStrictEqual(await match(db, `%${escapeLike('\\dir')}%`), [
        nullObj({ name: 'C:\\dir\\file' }),
      ]);
      await db.close();
    });

    it('`ohne_lower` lowercases text and keeps `NULL`', async () => {
      const db = await open();
      deepStrictEqual(await db.query(`SELECT ohne_lower('ÄÖÜ Σ') AS v, ohne_lower(NULL) AS n`), [
        nullObj({ v: 'äöü σ', n: null }),
      ]);
      await db.close();
    });

    it('rides the default insensitive LIKE: the pragmas never set `case_sensitive_like`', async () => {
      const db = await seed(['ABC']);
      deepStrictEqual(await db.query(`SELECT name FROM t WHERE name LIKE 'a%'`), [
        nullObj({ name: 'ABC' }),
      ]);
      await db.close();
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

    it('rethrows the failure that made SQLite roll back on its own', async () => {
      const db = await open();
      await fillUp(db);
      await rejects(
        db.transaction((tx) => tx.run('INSERT INTO t (v) VALUES (?)', ['x'.repeat(100_000)])),
        /database or disk is full/,
      );
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

    it('rolls back on success but returns the result when commit is false', async () => {
      const db = await open();
      const result = await dialect.schemaTransaction(
        db,
        async (tx) => {
          await tx.exec('CREATE TABLE t (id TEXT PRIMARY KEY)');
          await tx.run('INSERT INTO t (id) VALUES (?)', ['a']);
          return 'done';
        },
        { commit: false },
      );
      strictEqual(result, 'done');
      deepStrictEqual(await dialect.listTables(db), []);
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

    it('rethrows the failure that made SQLite roll back on its own', async () => {
      const db = await open();
      await fillUp(db);
      await rejects(
        dialect.schemaTransaction(db, (tx) =>
          tx.run('INSERT INTO t (v) VALUES (?)', ['x'.repeat(100_000)]),
        ),
        /database or disk is full/,
      );
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

    it('parses a unique violation into its table and columns', async () => {
      const db = await open();
      await db.exec('CREATE TABLE t (id TEXT PRIMARY KEY, a TEXT, b TEXT, UNIQUE (a, b))');
      await db.run('INSERT INTO t (id, a, b) VALUES (?, ?, ?)', ['x', '1', '2']);
      const single = await errorOf(db.run('INSERT INTO t (id, a) VALUES (?, ?)', ['x', '9']));
      deepStrictEqual(dialect.uniqueViolationTarget(single), { table: 't', columns: ['id'] });
      const pair = await errorOf(
        db.run('INSERT INTO t (id, a, b) VALUES (?, ?, ?)', ['y', '1', '2']),
      );
      deepStrictEqual(dialect.uniqueViolationTarget(pair), { table: 't', columns: ['a', 'b'] });
      strictEqual(dialect.uniqueViolationTarget(new Error('boom')), null);
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

    it("renewLock moves the holder's acquiredAt to now and leaves a rival's row alone", async (t) => {
      const db = await open();
      const handle = await dialect.acquireLock(db, 'sync');
      ok(handle);
      const renewed = [nullObj({ acquiredAt: 5_000 })];
      t.mock.timers.enable({ apis: ['Date'], now: 5_000 });
      await dialect.renewLock(db, handle);
      deepStrictEqual(await db.query('SELECT "acquiredAt" FROM "ohne_locks"'), renewed);
      t.mock.timers.tick(1_000);
      await dialect.renewLock(db, { key: 'sync', nonce: 'wrong' });
      deepStrictEqual(await db.query('SELECT "acquiredAt" FROM "ohne_locks"'), renewed);
      await db.close();
    });

    it('releaseAbandonedLock frees an absent or abandoned key and keeps a live one', async () => {
      const db = await open();
      await dialect.waitForLock(db, 'sync', { pollInterval: 5, staleAfter: 50 });
      strictEqual(await dialect.releaseAbandonedLock(db, 'sync', 50), true);
      ok(await dialect.acquireLock(db, 'sync'));
      strictEqual(await dialect.releaseAbandonedLock(db, 'sync', 10_000), false);
      strictEqual(await dialect.acquireLock(db, 'sync'), null);
      await db.run('UPDATE "ohne_locks" SET "acquiredAt" = ?', [Date.now() - 10_000]);
      strictEqual(await dialect.releaseAbandonedLock(db, 'sync', 50), true);
      deepStrictEqual(await db.query('SELECT * FROM "ohne_locks"'), []);
      await db.close();
    });

    it('ensures the lock table once per adapter', async (t) => {
      const db = await open();
      const exec = t.mock.method(db, 'exec');
      const handle = await dialect.acquireLock(db, 'sync');
      ok(handle);
      strictEqual(await dialect.acquireLock(db, 'sync'), null);
      await dialect.releaseLock(db, handle);
      await dialect.waitForLock(db, 'sync', { pollInterval: 5, staleAfter: 50 });
      strictEqual(exec.mock.callCount(), 1);
      await db.close();
    });
  });
});
