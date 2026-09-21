import { deepStrictEqual, ok, rejects, strictEqual } from 'node:assert';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, it } from 'node:test';

import { useCollections } from '../../../src/ohne/collections/use-collections.ts';
import { seedSingletons } from '../../../src/ohne/database/seed-singletons.ts';
import { syncProjectDatabase } from '../../../src/ohne/database/sync-project.ts';
import { closeDatabases, useDatabase } from '../../../src/ohne/database/use-database.ts';
import { useEnv } from '../../../src/ohne/env/use-env.ts';
import { isOhneError } from '../../../src/ohne/error/ohne-error.ts';
import { field } from '../../../src/ohne/fields/field.ts';
import { hook } from '../../../src/ohne/hooks/hook.ts';
import { useHooks } from '../../../src/ohne/hooks/use-hooks.ts';
import { usePrinter } from '../../../src/ohne/printer/use-printer.ts';
import { queryUntyped } from '../../../src/ohne/query/query.ts';

usePrinter().configure({ stream: { write: () => true } });

const register = (name: string, collection: Record<string, unknown>) =>
  useCollections().register(name, { name, collection } as never);

const settings = {
  singleton: true,
  fields: {
    title: field('text', { default: 'My site' }),
    tagline: field('text', { nullable: true }),
  },
};

describe('seedSingletons', () => {
  afterEach(async () => {
    await closeDatabases();
    useEnv().unset('DATABASE');
    useHooks().clear();
    for (const name of ['SSSettings', 'SSPosts', 'SSDropped']) useCollections().delete(name);
    usePrinter().configure({ stream: { write: () => true } });
  });

  it('seeds one record from the field defaults at the first sync', async () => {
    useEnv().set('DATABASE', ':memory:');
    register('SSSettings', settings);
    register('SSPosts', { fields: { title: field('text') } });
    await syncProjectDatabase();
    const rows = await queryUntyped('SSSettings').select('title', 'tagline').findMany();
    deepStrictEqual(rows, [{ title: 'My site', tagline: null }]);
    strictEqual(await queryUntyped('SSPosts').count(), 0);
  });

  it('leaves an existing record alone', async () => {
    useEnv().set('DATABASE', ':memory:');
    register('SSSettings', settings);
    await syncProjectDatabase();
    await queryUntyped('SSSettings').update({ title: 'Changed' });
    await seedSingletons();
    const rows = await queryUntyped('SSSettings').select('title').findMany();
    deepStrictEqual(rows, [{ title: 'Changed' }]);
  });

  it('seeds once when two seeders race', async () => {
    useEnv().set('DATABASE', ':memory:');
    register('SSSettings', settings);
    await syncProjectDatabase();
    await useDatabase().run('DELETE FROM "SSSettings"');
    await Promise.all([seedSingletons(), seedSingletons()]);
    strictEqual(await queryUntyped('SSSettings').count(), 1);
  });

  it('seeds nothing under `dryRun`', async () => {
    useEnv().set('DATABASE', ':memory:');
    register('SSSettings', settings);
    await syncProjectDatabase({ dryRun: true });
    const tables = await useDatabase().query<{ name: string }>(
      "SELECT name FROM sqlite_master WHERE type = 'table'",
    );
    ok(!tables.some((table) => table.name === 'SSSettings'));
  });

  it('fires the record hooks, and seeds before `schema:synced`', async () => {
    useEnv().set('DATABASE', ':memory:');
    register('SSSettings', settings);
    const created: unknown[] = [];
    let seededAtSync = -1;
    hook('record:after-create', (record) => {
      created.push(record.title);
    });
    hook('schema:synced', async () => {
      seededAtSync = await queryUntyped('SSSettings').count();
    });
    await syncProjectDatabase();
    deepStrictEqual(created, ['My site']);
    strictEqual(seededAtSync, 1);
  });

  it('throws naming the field when a hook rejects the seed', async () => {
    useEnv().set('DATABASE', ':memory:');
    register('SSSettings', settings);
    hook('record:validate', () => ({ title: 'No.' }));
    await rejects(syncProjectDatabase(), (error: unknown) => {
      ok(isOhneError(error));
      strictEqual(error.title, 'Cannot seed singleton `SSSettings`');
      ok([error.body].flat().includes('- `title`: No.'));
      return true;
    });
  });

  it('reports the data a sync removed even when the seed then fails', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ohne-seed-singletons-'));
    try {
      useEnv().set('DATABASE', join(dir, 'app.sqlite'));
      register('SSDropped', {
        fields: { title: field('text'), extra: field('text', { nullable: true }) },
      });
      await syncProjectDatabase();
      await queryUntyped('SSDropped').createOrThrow({ title: 'a', extra: 'kept' });
      await closeDatabases();

      useCollections().delete('SSDropped');
      register('SSDropped', { fields: { title: field('text') } });
      register('SSSettings', settings);
      hook('record:validate', (_errors, _scope, ctx) =>
        ctx.collection === 'SSSettings' ? { title: 'No.' } : undefined,
      );
      let printed = '';
      usePrinter().configure({
        stream: {
          write: (chunk: string) => {
            printed += chunk;
            return true;
          },
        },
      });
      await rejects(syncProjectDatabase({ force: true }), /Cannot seed singleton/);
      ok(printed.includes('SSDropped.extra'));
    } finally {
      await closeDatabases();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
