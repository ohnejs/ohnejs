import { ok, rejects, strictEqual, throws } from 'node:assert';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, it } from 'node:test';
import { useEnv, useLayers } from 'ohnejs';

import { connect } from '../../../src/ohne/database/connect.ts';
import { closeDatabases, useDatabase } from '../../../src/ohne/database/use-database.ts';

describe('connect', () => {
  const layerPaths = ['/db-connect-helper', '/db-connect-dialect'];

  afterEach(async () => {
    await closeDatabases();
    useEnv().unset('DATABASE');
    useEnv().unset('DB');
    for (const path of layerPaths) useLayers().remove(path);
  });

  it('opens the main connection from DATABASE and serves it through useDatabase', async () => {
    useEnv().set('DATABASE', ':memory:');
    await connect();
    await useDatabase().exec('CREATE TABLE t (id TEXT PRIMARY KEY)');
    strictEqual((await useDatabase().run('INSERT INTO t (id) VALUES (?)', ['a'])).changes, 1);
  });

  it('opens helpers declared in config, reachable by name', async () => {
    useEnv().set('DATABASE', ':memory:');
    useLayers().add({
      path: '/db-connect-helper',
      input: { database: { helpers: { cache: ':memory:' } } },
    });
    await connect();
    await useDatabase('cache').exec('CREATE TABLE c (k TEXT PRIMARY KEY)');
    strictEqual((await useDatabase('cache').run('INSERT INTO c (k) VALUES (?)', ['x'])).changes, 1);
  });

  it('resolves a relative database path against the app root', async () => {
    const root = mkdtempSync(join(tmpdir(), 'ohne-connect-root-'));
    useLayers().add({ path: root, input: { database: { url: 'nested/app.db' } } });
    await connect();
    await useDatabase().exec('CREATE TABLE t (id TEXT PRIMARY KEY)');
    ok(existsSync(join(root, 'nested', 'app.db')));
    await closeDatabases();
    useLayers().remove(root);
    rmSync(root, { recursive: true, force: true });
  });

  it('throws when both DATABASE and DB are set', async () => {
    useEnv().set('DATABASE', ':memory:');
    useEnv().set('DB', ':memory:');
    await rejects(connect(), /Both `DATABASE` and `DB` are set/);
  });

  it('throws on an unknown dialect', async () => {
    useEnv().set('DATABASE', ':memory:');
    useLayers().add({
      path: '/db-connect-dialect',
      input: { database: { dialect: 'nope' as never } },
    });
    await rejects(connect(), /Unknown database dialect `nope`/);
  });

  it('throws from useDatabase before connecting', () => {
    throws(() => useDatabase(), /The database is not connected/);
  });

  it('throws from useDatabase for an unknown helper', async () => {
    useEnv().set('DATABASE', ':memory:');
    await connect();
    throws(() => useDatabase('missing'), /Unknown database helper `missing`/);
  });
});
