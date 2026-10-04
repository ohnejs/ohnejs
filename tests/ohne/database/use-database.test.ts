import { strictEqual, throws } from 'node:assert';
import { afterEach, describe, it } from 'node:test';
import { setImmediate } from 'node:timers/promises';
import { useEnv } from 'ohnejs';

import type { DatabaseAdapter } from '../../../src/ohne/database/adapter.ts';
import type { Event, Route } from '../../../src/ohne/index.ts';

import { connect } from '../../../src/ohne/database/connect.ts';
import {
  bindDatabase,
  closeDatabases,
  registerDatabase,
  useDatabase,
  useDialect,
} from '../../../src/ohne/database/use-database.ts';
import { dispatch } from '../../../src/ohne/http/dispatch.ts';
import { runWithEvent, useEvent } from '../../../src/ohne/http/use-event.ts';
import { DEFAULTS } from '../../../src/ohne/layers/config.ts';
import { useLayers } from '../../../src/ohne/layers/use-layers.ts';

useLayers().add({ path: '/use-database-test', defaults: DEFAULTS, input: {} });

function event(): Event {
  return {
    request: new Request('http://localhost/'),
    url: new URL('http://localhost/'),
    params: {},
    ip: '',
    response: { status: 200, headers: new Headers() },
    context: {},
    appliedMiddleware: [],
    waitUntil() {},
  };
}

describe('bindDatabase', () => {
  const opened: DatabaseAdapter[] = [];

  afterEach(async () => {
    await closeDatabases();
    for (const adapter of opened.splice(0)) await adapter.close();
    useEnv().unset('DATABASE');
  });

  async function open(): Promise<DatabaseAdapter> {
    useEnv().set('DATABASE', ':memory:');
    await connect();
    return useDatabase();
  }

  async function another(): Promise<DatabaseAdapter> {
    const adapter = await useDialect().connect(':memory:');
    opened.push(adapter);
    return adapter;
  }

  it('leaves `useDatabase()` on the main connection outside a request', async () => {
    const main = await open();
    strictEqual(useDatabase(), main);
  });

  it('leaves `useDatabase()` on the main connection in a request that binds nothing', async () => {
    const main = await open();
    strictEqual(
      runWithEvent(event(), () => useDatabase()),
      main,
    );
  });

  it('answers the bound adapter for the rest of the request, at any async depth', async () => {
    await open();
    const bound = await another();
    const seen = await runWithEvent(event(), async () => {
      bindDatabase(bound);
      await setImmediate();
      return (async () => {
        await setImmediate();
        return useDatabase();
      })();
    });
    strictEqual(seen, bound);
  });

  it('leaves a named helper untouched', async () => {
    await open();
    const helper = await useDialect().connect(':memory:');
    registerDatabase(helper, 'cache');
    const seen = runWithEvent(event(), () => {
      bindDatabase(useDatabase());
      return useDatabase('cache');
    });
    strictEqual(seen, helper);
  });

  it('keeps two concurrent requests on their own adapters across `await`', async () => {
    await open();
    const first = await another();
    const second = await another();
    const gate = Promise.withResolvers<void>();
    const run = (adapter: DatabaseAdapter) =>
      runWithEvent(event(), async () => {
        bindDatabase(adapter);
        await gate.promise;
        return useDatabase();
      });
    const seen = Promise.all([run(first), run(second)]);
    gate.resolve();
    const [a, b] = await seen;
    strictEqual(a, first);
    strictEqual(b, second);
  });

  it('writes through the bound adapter, not the main connection', async () => {
    const main = await open();
    const bound = await another();
    await main.exec('CREATE TABLE t (id TEXT PRIMARY KEY)');
    await bound.exec('CREATE TABLE t (id TEXT PRIMARY KEY)');
    await runWithEvent(event(), async () => {
      bindDatabase(bound);
      await useDatabase().run('INSERT INTO t (id) VALUES (?)', ['a']);
    });
    strictEqual((await bound.query('SELECT id FROM t')).length, 1);
    strictEqual((await main.query('SELECT id FROM t')).length, 0);
  });

  it('throws outside a request', async () => {
    const main = await open();
    throws(() => bindDatabase(main), /outside of a request/);
  });

  it('carries the binding into `waitUntil` work', async () => {
    await open();
    const bound = await another();
    let seen: DatabaseAdapter | undefined;
    const route: Route = {
      method: 'GET',
      pattern: '/',
      file: '/.ts',
      layer: 'test',
      handler: async () => {
        bindDatabase(bound);
        useEvent().waitUntil(
          (async () => {
            await setImmediate();
            seen = useDatabase();
          })(),
        );
        return 'ok';
      },
    };
    const { drain } = await dispatch(
      route,
      new Request('http://localhost/'),
      new URL('http://localhost/'),
      {},
    );
    await drain();
    strictEqual(seen, bound);
  });
});
