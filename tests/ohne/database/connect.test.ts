import { match, ok, rejects, strictEqual, throws } from 'node:assert';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, it } from 'node:test';
import { type OhneError, useEnv, useLayers } from 'ohnejs';

import type { Dialect } from '../../../src/ohne/database/dialect.ts';

import { connect } from '../../../src/ohne/database/connect.ts';
import { closeDatabases, useDatabase } from '../../../src/ohne/database/use-database.ts';
import { useDialects } from '../../../src/ohne/database/use-dialects.ts';
import { dialect, memoryURL } from '../../_dialect.ts';

describe('connect', () => {
  const layerPaths = ['/db-connect-helper', '/db-connect-dialect', '/db-connect-mismatch'];

  afterEach(async () => {
    await closeDatabases();
    useEnv().unset('DATABASE');
    useEnv().unset('DB');
    for (const path of layerPaths) useLayers().remove(path);
  });

  it('opens the main connection from DATABASE and serves it through useDatabase', async () => {
    useEnv().set('DATABASE', memoryURL);
    await connect();
    await useDatabase().exec('CREATE TABLE t (id TEXT PRIMARY KEY)');
    strictEqual((await useDatabase().run('INSERT INTO t (id) VALUES (?)', ['a'])).changes, 1);
  });

  it('opens helpers declared in config, reachable by name', async () => {
    useEnv().set('DATABASE', memoryURL);
    useLayers().add({
      path: '/db-connect-helper',
      input: { database: { helpers: { cache: memoryURL } } },
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
    useEnv().set('DATABASE', memoryURL);
    useEnv().set('DB', memoryURL);
    await rejects(connect(), /Both `DATABASE` and `DB` are set/);
  });

  it('throws on an unknown dialect', async () => {
    useEnv().set('DATABASE', memoryURL);
    useLayers().add({
      path: '/db-connect-dialect',
      input: { database: { dialect: 'nope' as never } },
    });
    await rejects(connect(), /Unknown database dialect `nope`/);
  });

  it('infers the dialect from the URL when none is configured', async () => {
    const stub: Dialect = Object.assign(Object.create(dialect), {
      name: 'stub',
      accepts: (url: string) => url.startsWith('stub://'),
      connect: () => dialect.connect(memoryURL),
    });
    useDialects().register('stub', stub);
    try {
      useEnv().set('DATABASE', 'stub://x/db');
      strictEqual(await connect(), stub);
      await closeDatabases();
      useEnv().set('DATABASE', memoryURL);
      strictEqual((await connect()).name, dialect.name);
    } finally {
      useDialects().delete('stub');
    }
  });

  it('refuses a URL the dialect cannot open, printing it without secrets', async () => {
    useEnv().set('DATABASE', 'postgres://u:secret@x/db?password=p');
    useLayers().add({ path: '/db-connect-mismatch', input: { database: { dialect: 'sqlite' } } });
    const error = await connect().then(
      () => undefined,
      (caught: unknown) => caught as OhneError,
    );
    ok(error);
    match(error.message, /The database URL does not fit `sqlite`/);
    const printed = `${error.message}\n${JSON.stringify(error.body)}`;
    match(printed, /x\/db/);
    ok(!printed.includes('secret'));
    ok(!printed.includes('password=p'));
  });

  it('refuses a helper URL the dialect cannot open', async () => {
    useEnv().set('DATABASE', memoryURL);
    useLayers().add({
      path: '/db-connect-helper',
      input: { database: { helpers: { cache: 'mysql://x/cache' } } },
    });
    await rejects(connect(), new RegExp(`The database URL does not fit \`${dialect.name}\``));
  });

  it('throws from useDatabase before connecting', () => {
    throws(() => useDatabase(), /The database is not connected/);
  });

  it('throws from useDatabase for an unknown helper', async () => {
    useEnv().set('DATABASE', memoryURL);
    await connect();
    throws(() => useDatabase('missing'), /Unknown database helper `missing`/);
  });
});
