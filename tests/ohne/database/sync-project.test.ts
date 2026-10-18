import { deepStrictEqual, ok, rejects, strictEqual } from 'node:assert';
import { afterEach, describe, it } from 'node:test';

import { useCollections } from '../../../src/ohne/collections/use-collections.ts';
import { connect } from '../../../src/ohne/database/connect.ts';
import { isProjectSynced, syncProjectDatabase } from '../../../src/ohne/database/sync-project.ts';
import { closeDatabases, useDatabase } from '../../../src/ohne/database/use-database.ts';
import { useEnv } from '../../../src/ohne/env/use-env.ts';
import { isOhneError } from '../../../src/ohne/error/ohne-error.ts';
import { field } from '../../../src/ohne/fields/field.ts';
import { usePrinter } from '../../../src/ohne/printer/use-printer.ts';
import { dialect, memoryURL } from '../../_dialect.ts';

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
    useEnv().set('DATABASE', memoryURL);
    register('SPBad', { body: field('text', { default: '' }) });
    await rejects(syncProjectDatabase(), (error: unknown) => {
      ok(isOhneError(error));
      return error.title === 'Field `body` defaults to a value it rejects';
    });
    deepStrictEqual(await dialect.listTables(useDatabase()), []);
  });

  it('syncs a schema whose literal defaults pass', async () => {
    useEnv().set('DATABASE', memoryURL);
    register('SPGood', { body: field('text', { default: '', allowEmpty: true }) });
    const report = await syncProjectDatabase();
    deepStrictEqual(report.deletions, []);
  });
});

describe('isProjectSynced', () => {
  afterEach(async () => {
    await closeDatabases();
    useEnv().unset('DATABASE');
    useCollections().delete('SPPosts');
  });

  it('holds once a sync realized the schema, never writing to a database no sync touched', async () => {
    useEnv().set('DATABASE', memoryURL);
    await connect();
    strictEqual(await isProjectSynced(), true);
    register('SPPosts', { title: field('text') });
    strictEqual(await isProjectSynced(), false);
    deepStrictEqual(await dialect.listTables(useDatabase()), []);
    await syncProjectDatabase();
    strictEqual(await isProjectSynced(), true);
    useCollections().delete('SPPosts');
    register('SPPosts', { title: field('text'), body: field('text', { default: 'b' }) });
    strictEqual(await isProjectSynced(), false);
  });
});
