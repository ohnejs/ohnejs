import { deepStrictEqual, ok, strictEqual } from 'node:assert';
import { afterEach, before, describe, it } from 'node:test';

import type { AnyHandler, Route } from '../../../src/ohne/index.ts';

import {
  badRequest,
  defineHandler,
  dispatch,
  hook,
  notFound,
  setResponseStatus,
  useEvent,
  useHooks,
  useMiddleware,
  usePrinter,
  waitUntil,
} from '../../../src/ohne/index.ts';
import { sleep } from '../../../src/utils/index.ts';

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

afterEach(() => {
  useMiddleware().clear();
  useHooks().clear();
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

  it('exposes the client IP on event.ip, defaulting to empty', async () => {
    const route = makeRoute('/', () => useEvent().ip);

    const withIP = await dispatch(route, req(), url(), {}, { ip: '203.0.113.9' });
    strictEqual(await withIP.response.text(), '203.0.113.9');

    const withoutIP = await dispatch(route, req(), url(), {});
    strictEqual(await withoutIP.response.text(), '');
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

  it('answers 503 when the handler overruns handlerTimeout', async () => {
    const route = makeRoute('/', async () => {
      await sleep(50);
      return { ok: true };
    });
    const { response } = await dispatch(route, req(), url(), {}, { handlerTimeout: 5 });
    strictEqual(response.status, 503);
    deepStrictEqual(await response.json(), {
      statusCode: 503,
      message: 'Service Unavailable',
    });
  });

  it('returns normally when the handler finishes within handlerTimeout', async () => {
    const route = makeRoute('/', () => ({ ok: true }));
    const { response } = await dispatch(route, req(), url(), {}, { handlerTimeout: 1000 });
    strictEqual(response.status, 200);
    deepStrictEqual(await response.json(), { ok: true });
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

  it('abandons a waitUntil promise that overruns waitUntilTimeout', async () => {
    const route = makeRoute('/', () => {
      waitUntil(new Promise<void>(() => {}));
      return 'ok';
    });
    const { response, drain } = await dispatch(route, req(), url(), {}, { waitUntilTimeout: 10 });

    strictEqual(await response.text(), 'ok');
    await drain();
  });

  it('lets a waitUntil promise settle within waitUntilTimeout', async () => {
    let done = false;
    const route = makeRoute('/', () => {
      waitUntil(
        sleep(1).then(() => {
          done = true;
        }),
      );
      return 'ok';
    });
    const { drain } = await dispatch(route, req(), url(), {}, { waitUntilTimeout: 1000 });

    await drain();
    strictEqual(done, true);
  });

  it('runs global middleware before the handler, sharing the event', async () => {
    useMiddleware().registerGlobal('global-tag', (event) => {
      event.response.headers.set('x-mw', 'on');
      (event.context as Record<string, unknown>).role = 'admin';
    });
    const route = makeRoute('/', () => useEvent().context as Record<string, unknown>);
    const { response } = await dispatch(route, req(), url(), {});
    strictEqual(response.headers.get('x-mw'), 'on');
    deepStrictEqual(await response.json(), { role: 'admin' });
  });

  it('short-circuits when a global middleware returns a value', async () => {
    let handlerRan = false;
    useMiddleware().registerGlobal('global-guard', () => badRequest('blocked'));
    const route = makeRoute('/', () => {
      handlerRan = true;
      return 'ok';
    });
    const { response } = await dispatch(route, req(), url(), {});
    strictEqual(response.status, 400);
    strictEqual(handlerRan, false);
  });

  it('runs global middleware in registration order, before the handler', async () => {
    const order: string[] = [];
    for (const name of ['10', '2', 'auth']) {
      useMiddleware().registerGlobal(name, () => {
        order.push(name);
      });
    }
    const route = makeRoute('/', () => {
      order.push('handler');
      return 'ok';
    });
    await dispatch(route, req(), url(), {});
    deepStrictEqual(order, ['10', '2', 'auth', 'handler']);
  });

  it('runs only the named middleware a route selects, after the globals', async () => {
    const order: string[] = [];
    useMiddleware().registerGlobal('global-tag', () => {
      order.push('global-tag');
    });
    for (const name of ['audit', 'rate']) {
      useMiddleware().register(name, () => {
        order.push(name);
      });
    }
    const route = makeRoute(
      '/',
      defineHandler(() => useEvent().appliedMiddleware, { middleware: ['rate'] }),
    );
    const { response } = await dispatch(route, req(), url(), {});
    deepStrictEqual(order, ['global-tag', 'rate']);
    deepStrictEqual(await response.json(), ['global-tag', 'rate']);
  });

  it('runs the route selection in the order given', async () => {
    const order: string[] = [];
    for (const name of ['n1', 'n2']) {
      useMiddleware().register(name, () => {
        order.push(name);
      });
    }
    const route = makeRoute(
      '/',
      defineHandler(() => 'ok', { middleware: ['n2', 'n1'] }),
    );
    await dispatch(route, req(), url(), {});
    deepStrictEqual(order, ['n2', 'n1']);
  });

  it('selects named middleware with a function form', async () => {
    for (const name of ['a', 'b', 'c']) useMiddleware().register(name, () => undefined);
    const route = makeRoute(
      '/',
      defineHandler(() => useEvent().appliedMiddleware, {
        middleware: (available) => available.filter((name) => name !== 'b'),
      }),
    );
    const { response } = await dispatch(route, req(), url(), {});
    deepStrictEqual(await response.json(), ['a', 'c']);
  });

  it('drops a selected name that is not a known middleware', async () => {
    let handlerRan = false;
    const route = makeRoute(
      '/',
      defineHandler(
        () => {
          handlerRan = true;
          return useEvent().appliedMiddleware;
        },
        { middleware: ['ghost'] },
      ),
    );
    const { response } = await dispatch(route, req(), url(), {});
    strictEqual(handlerRan, true);
    deepStrictEqual(await response.json(), []);
  });

  it('runs only globals when the route selects no middleware', async () => {
    useMiddleware().register('named', () => undefined);
    useMiddleware().registerGlobal('global-only', () => undefined);
    const route = makeRoute('/', () => useEvent().appliedMiddleware);
    const { response } = await dispatch(route, req(), url(), {});
    deepStrictEqual(await response.json(), ['global-only']);
  });

  it('de-duplicates a repeated middleware selection', async () => {
    const order: string[] = [];
    for (const name of ['a', 'b']) {
      useMiddleware().register(name, () => {
        order.push(name);
      });
    }
    const route = makeRoute(
      '/',
      defineHandler(() => useEvent().appliedMiddleware, {
        middleware: (available) => [...available, 'a'],
      }),
    );
    const { response } = await dispatch(route, req(), url(), {});
    deepStrictEqual(order, ['a', 'b']);
    deepStrictEqual(await response.json(), ['a', 'b']);
  });

  it('maps an unexpected throw from middleware to a generic 500', async () => {
    useMiddleware().registerGlobal('boom', () => {
      throw new Error('mw exploded');
    });
    const { response } = await dispatch(
      makeRoute('/', () => 'ok'),
      req(),
      url(),
      {},
    );
    strictEqual(response.status, 500);
  });

  it('records the middleware that ran on event.appliedMiddleware', async () => {
    for (const name of ['a', 'b']) useMiddleware().registerGlobal(name, () => undefined);
    const route = makeRoute('/', () => useEvent().appliedMiddleware);
    const { response } = await dispatch(route, req(), url(), {});
    deepStrictEqual(await response.json(), ['a', 'b']);
  });

  it('lets the middleware:resolve hook filter and reorder', async () => {
    const order: string[] = [];
    for (const name of ['a', 'b', 'c']) {
      useMiddleware().registerGlobal(name, () => {
        order.push(name);
      });
    }
    hook('middleware:resolve', (names) => names.filter((name) => name !== 'b').reverse());
    const route = makeRoute('/', () => useEvent().appliedMiddleware);
    const { response } = await dispatch(route, req(), url(), {});
    deepStrictEqual(order, ['c', 'a']);
    deepStrictEqual(await response.json(), ['c', 'a']);
  });

  it('runs the hook over the globals and route selection together', async () => {
    const order: string[] = [];
    useMiddleware().registerGlobal('g1', () => {
      order.push('g1');
    });
    for (const name of ['n1', 'n2']) {
      useMiddleware().register(name, () => {
        order.push(name);
      });
    }
    hook('middleware:resolve', (names) => names.filter((name) => name !== 'g1' && name !== 'n1'));
    const route = makeRoute(
      '/',
      defineHandler(() => useEvent().appliedMiddleware, { middleware: ['n1', 'n2'] }),
    );
    const { response } = await dispatch(route, req(), url(), {});
    deepStrictEqual(order, ['n2']);
    deepStrictEqual(await response.json(), ['n2']);
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
