import { deepStrictEqual, ok, strictEqual } from 'node:assert';
import { before, describe, it } from 'node:test';

import type { AnyHandler, Route } from '../../../src/ohne/index.ts';

import {
  badRequest,
  dispatch,
  notFound,
  setResponseStatus,
  useEvent,
  usePrinter,
  waitUntil,
} from '../../../src/ohne/index.ts';

function makeRoute(pattern: string, handler: AnyHandler): Route {
  return { method: 'GET', pattern, file: `${pattern}.ts`, layer: 'test', handler };
}

function req(url = 'http://localhost/'): Request {
  return new Request(url);
}

function url(href = 'http://localhost/'): URL {
  return new URL(href);
}

before(() => {
  usePrinter().configure({ stream: { write() {} } });
});

describe('dispatch', () => {
  it('serializes the handler return with a 200 default', async () => {
    const { response } = await dispatch(
      makeRoute('/', () => ({ hello: 'world' })),
      req(),
      url(),
      {},
    );
    strictEqual(response.status, 200);
    deepStrictEqual(await response.json(), { hello: 'world' });
  });

  it('binds the event and passes params to the handler', async () => {
    const route = makeRoute('/users/[id]', () => {
      const event = useEvent();
      return { id: event.params.id, path: event.url.pathname };
    });
    const { response } = await dispatch(
      route,
      req('http://localhost/users/42'),
      url('http://localhost/users/42'),
      { id: '42' },
    );
    deepStrictEqual(await response.json(), { id: '42', path: '/users/42' });
  });

  it('applies setResponseStatus from the handler', async () => {
    const route = makeRoute('/', () => {
      setResponseStatus(201);
      return { created: true };
    });
    const { response } = await dispatch(route, req(), url(), {});
    strictEqual(response.status, 201);
  });

  it('maps a thrown HTTPError', async () => {
    const route = makeRoute('/', () => {
      throw notFound('gone');
    });
    const { response } = await dispatch(route, req(), url(), {});
    strictEqual(response.status, 404);
    deepStrictEqual(await response.json(), { statusCode: 404, message: 'gone' });
  });

  it('maps a returned HTTPError', async () => {
    const { response } = await dispatch(
      makeRoute('/', () => badRequest('nope')),
      req(),
      url(),
      {},
    );
    strictEqual(response.status, 400);
  });

  it('maps an unexpected throw to a generic 500 without leaking it', async () => {
    const route = makeRoute('/', () => {
      throw new Error('db exploded');
    });
    const { response } = await dispatch(route, req(), url(), {});
    strictEqual(response.status, 500);
    const body = await response.json();
    deepStrictEqual(body, { statusCode: 500, message: 'Internal Server Error' });
    ok(!JSON.stringify(body).includes('db exploded'));
  });

  it('holds background work until drain settles', async () => {
    let resolve!: () => void;
    const work = new Promise<void>((r) => (resolve = r));
    let done = false;
    const tracked = work.then(() => {
      done = true;
    });

    const route = makeRoute('/', () => {
      waitUntil(tracked);
      return 'ok';
    });
    const { response, drain } = await dispatch(route, req(), url(), {});

    strictEqual(await response.text(), 'ok');
    strictEqual(done, false);

    const draining = drain();
    setTimeout(resolve, 0);
    await draining;
    strictEqual(done, true);
  });

  it('isolates a rejected waitUntil', async () => {
    const route = makeRoute('/', () => {
      waitUntil(Promise.reject(new Error('background boom')));
      return 'ok';
    });
    const { drain } = await dispatch(route, req(), url(), {});
    await drain();
  });

  it('drains a re-entrant waitUntil', async () => {
    let releaseFirst!: () => void;
    const first = new Promise<void>((r) => (releaseFirst = r));
    let resolveInner!: () => void;
    const inner = new Promise<void>((r) => (resolveInner = r));
    let innerSettled = false;
    inner.then(() => {
      innerSettled = true;
    });

    const route = makeRoute('/', () => {
      waitUntil(
        first.then(() => {
          waitUntil(inner);
        }),
      );
      return 'ok';
    });
    const { drain } = await dispatch(route, req(), url(), {});

    const draining = drain();
    releaseFirst();
    setTimeout(resolveInner, 0);
    await draining;
    strictEqual(innerSettled, true);
  });
});
