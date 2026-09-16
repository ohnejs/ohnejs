import { deepStrictEqual, ok, rejects } from 'node:assert';
import { afterEach, describe, it } from 'node:test';

import { useCollections } from '../../../src/ohne/collections/use-collections.ts';
import { syncProjectDatabase } from '../../../src/ohne/database/sync-project.ts';
import { closeDatabases, useDatabase } from '../../../src/ohne/database/use-database.ts';
import { useEnv } from '../../../src/ohne/env/use-env.ts';
import { isOhneError } from '../../../src/ohne/error/ohne-error.ts';
import { field } from '../../../src/ohne/fields/field.ts';
import { usePrinter } from '../../../src/ohne/printer/use-printer.ts';

usePrinter().configure({ stream: { write: () => true } });

const register = (name: string, fields: Record<string, unknown>) =>
  useCollections().register(name, { name, collection: { fields } } as never);

describe('syncProjectDatabase', () => {
  afterEach(async () => {
    await closeDatabases();
    useEnv().unset('DATABASE');
    for (const name of ['SPBad', 'SPGood']) useCollections().delete(name);
  });

  it('rejects a literal default the field rejects, before the reconcile', async () => {
    useEnv().set('DATABASE', ':memory:');
    register('SPBad', { body: field('text', { default: '' }) });
    await rejects(syncProjectDatabase(), (error: unknown) => {
      ok(isOhneError(error));
      return error.title === 'Field `body` defaults to a value it rejects';
    });
    const tables = await useDatabase().query("SELECT name FROM sqlite_master WHERE type = 'table'");
    deepStrictEqual(tables, []);
  });

  it('syncs a schema whose literal defaults pass', async () => {
    useEnv().set('DATABASE', ':memory:');
    register('SPGood', { body: field('text', { default: '', allowEmpty: true }) });
    const report = await syncProjectDatabase();
    deepStrictEqual(report.deletions, []);
  });
});
