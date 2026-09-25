import type { IncomingHttpHeaders, Server, ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';

import { deepStrictEqual, strictEqual } from 'node:assert';
import { once } from 'node:events';
import { request } from 'node:http';
import { afterEach, before, describe, it } from 'node:test';

import type { AnyHandler, CreateServerOptions, Route } from '../../../src/ohne/index.ts';
import type { Gate, HTTPMethod } from '../../../src/utils/index.ts';

import {
  cors,
  createRouter,
  createServer,
  defineHandler,
  hook,
  useEvent,
  useHooks,
  useMiddleware,
  usePrinter,
  useRequest,
  waitUntil,
} from '../../../src/ohne/index.ts';
import { isUndefined, sleep } from '../../../src/utils/index.ts';

function makeRoute(method: HTTPMethod, pattern: string, handler: AnyHandler): Route {
  return { method, pattern, file: `${pattern}.ts`, layer: 'test', handler };
}

async function waitFor(condition: () => boolean): Promise<void> {
  for (let i = 0; i < 200 && !condition(); i++) await sleep(5);
}

async function withServer(
  routes: Route[],
  run: (base: string, gate: Gate, server: Server) => Promise<void>,
  options: CreateServerOptions = {},
): Promise<void> {
  const { server, gate } = createServer(createRouter(routes), options);
  server.listen(0);
  await once(server, 'listening');
  const { port } = server.address() as AddressInfo;
  try {
    await run(`http://localhost:${port}`, gate, server);
  } finally {
    server.close();
    server.closeAllConnections();
  }
}

function statusWithHost(base: string, host: string): Promise<number> {
  const { port } = new URL(base);
  return new Promise((resolve, reject) => {
    const req = request({ port, path: '/', headers: { host, connection: 'close' } }, (res) => {
      res.resume();
      resolve(res.statusCode ?? 0);
    });
    req.on('error', reject);
    req.end();
  });
}

function statusWithHeaderOf(base: string, size: number): Promise<number> {
  const { port } = new URL(base);
  return new Promise((resolve, reject) => {
    const headers = { 'x-big': 'a'.repeat(size), connection: 'close' };
    const req = request({ port, path: '/', headers }, (res) => {
      res.resume();
      resolve(res.statusCode ?? 0);
    });
    req.on('error', reject);
    req.end();
  });
}

function optionsRequest(
  base: string,
  path: string,
  headers: Record<string, string>,
): Promise<{ status: number; headers: IncomingHttpHeaders }> {
  const { port } = new URL(base);
  return new Promise((resolve, reject) => {
    const req = request(
      { port, path, method: 'OPTIONS', headers: { ...headers, connection: 'close' } },
      (res) => {
        res.resume();
        resolve({ status: res.statusCode ?? 0, headers: res.headers });
      },
    );
    req.on('error', reject);
    req.end();
  });
}

before(() => {
  usePrinter().configure({ stream: { write() {} } });
});

afterEach(() => {
  useMiddleware().clear();
  useHooks().clear();
});

describe('createServer', () => {
  it('serializes a matched handler return', async () => {
    await withServer(
      [makeRoute('GET', '/users/[id]', () => ({ id: useEvent().params.id }))],
      async (base) => {
        const res = await fetch(`${base}/users/42`);
        strictEqual(res.status, 200);
        strictEqual(((await res.json()) as { id: string }).id, '42');
      },
    );
  });

  it('answers an unmatched path with 404', async () => {
    await withServer([makeRoute('GET', '/', () => 'home')], async (base) => {
      const res = await fetch(`${base}/nope`);
      strictEqual(res.status, 404);
      await res.body?.cancel();
    });
  });

  it('answers a wrong method with 405 and an Allow header', async () => {
    await withServer([makeRoute('GET', '/users', () => [])], async (base) => {
      const res = await fetch(`${base}/users`, { method: 'DELETE' });
      strictEqual(res.status, 405);
      strictEqual(res.headers.get('allow'), 'GET, HEAD');
      await res.body?.cancel();
    });
  });

  it('answers OPTIONS to a route with no OPTIONS handler with 204 and Allow', async () => {
    await withServer([makeRoute('GET', '/users', () => [])], async (base) => {
      const { status, headers } = await optionsRequest(base, '/users', {});
      strictEqual(status, 204);
      strictEqual(headers['allow'], 'GET, HEAD, OPTIONS');
    });
  });

  it('runs global middleware for auto-OPTIONS so cors answers a preflight', async () => {
    useMiddleware().registerGlobal('global-cors', cors({ origin: 'https://app.example.com' }));
    await withServer([makeRoute('GET', '/data', () => ({ ok: true }))], async (base) => {
      const { status, headers } = await optionsRequest(base, '/data', {
        origin: 'https://app.example.com',
        'access-control-request-method': 'GET',
      });
      strictEqual(status, 204);
      strictEqual(headers['access-control-allow-origin'], 'https://app.example.com');
      strictEqual(headers['access-control-allow-methods'], 'GET, HEAD, PUT, PATCH, POST, DELETE');
      strictEqual(headers['vary'], 'Origin');
    });
  });

  it('serves a HEAD from the GET route with headers but no body', async () => {
    await withServer([makeRoute('GET', '/page', () => '<h1>hi</h1>')], async (base) => {
      const res = await fetch(`${base}/page`, { method: 'HEAD' });
      strictEqual(res.status, 200);
      strictEqual(res.headers.get('content-type'), 'text/html; charset=utf-8');
      strictEqual(await res.text(), '');
    });
  });

  it('refuses a request with 503 and Connection close while the gate is closing', async () => {
    await withServer([makeRoute('GET', '/', () => 'ok')], async (base, gate) => {
      await gate.close();
      const { port } = new URL(base);
      const req = request({ port, method: 'GET' });
      req.end();
      const [res] = await once(req, 'response');
      strictEqual(res.statusCode, 503);
      strictEqual(res.headers.connection, 'close');
      res.resume();
    });
  });

  it('holds the gate ticket until waitUntil settles', async () => {
    let resolveWork!: () => void;
    const work = new Promise<void>((resolve) => (resolveWork = resolve));
    const route = makeRoute('GET', '/bg', () => {
      waitUntil(work);
      return 'ok';
    });

    await withServer([route], async (base, gate) => {
      const res = await fetch(`${base}/bg`);
      strictEqual(await res.text(), 'ok');
      strictEqual(gate.pending, 1);

      resolveWork();
      await waitFor(() => gate.pending === 0);
      strictEqual(gate.pending, 0);
    });
  });

  it('fires request:complete only after background work drains', async () => {
    let resolveWork!: () => void;
    const work = new Promise<void>((resolve) => (resolveWork = resolve));
    let completed = false;
    let path = '';
    hook('request:complete', (event) => {
      completed = true;
      path = event.url.pathname;
    });
    const route = makeRoute('GET', '/bg', () => {
      waitUntil(work);
      return 'ok';
    });

    await withServer([route], async (base) => {
      const res = await fetch(`${base}/bg`);
      strictEqual(await res.text(), 'ok');
      strictEqual(completed, false);

      resolveWork();
      await waitFor(() => completed);
      strictEqual(completed, true);
      strictEqual(path, '/bg');
    });
  });

  it('releases the gate when a request:complete hook throws', async () => {
    hook('request:complete', () => {
      throw new Error('boom');
    });
    await withServer([makeRoute('GET', '/x', () => 'ok')], async (base, gate) => {
      const res = await fetch(`${base}/x`);
      strictEqual(await res.text(), 'ok');
      await waitFor(() => gate.pending === 0);
      strictEqual(gate.pending, 0);
    });
  });

  it('trusts X-Forwarded headers from a peer in the configured proxy CIDR', async () => {
    await withServer(
      [makeRoute('GET', '/p', () => useEvent().url.href)],
      async (base) => {
        const res = await fetch(`${base}/p`, {
          headers: { 'x-forwarded-proto': 'https', 'x-forwarded-host': 'example.com' },
        });
        strictEqual(await res.text(), 'https://example.com/p');
      },
      { trustProxy: ['127.0.0.1', '::1'] },
    );
  });

  it('exposes the resolved client IP on event.ip', async () => {
    await withServer(
      [makeRoute('GET', '/ip', () => useEvent().ip)],
      async (base) => {
        const res = await fetch(`${base}/ip`, {
          headers: { 'x-forwarded-for': '203.0.113.9, 10.0.0.1' },
        });
        strictEqual(await res.text(), '203.0.113.9');
      },
      { trustProxy: ['10.0.0.0/8', '127.0.0.1', '::1'] },
    );
  });
});

describe('per-route limits', () => {
  it('lets a route maxBodySize override loosen past the global cap', async () => {
    await withServer(
      [
        makeRoute(
          'POST',
          '/tight',
          defineHandler(() => 'ok'),
        ),
        makeRoute(
          'POST',
          '/loose',
          defineHandler(() => 'ok', { maxBodySize: '1kb' }),
        ),
      ],
      async (base) => {
        const body = 'x'.repeat(64);

        const tight = await fetch(`${base}/tight`, { method: 'POST', body });
        strictEqual(tight.status, 413);
        await tight.body?.cancel();

        const loose = await fetch(`${base}/loose`, { method: 'POST', body });
        strictEqual(await loose.text(), 'ok');
      },
      { maxBodySize: 8 },
    );
  });

  it('lets a route maxBodySize override tighten below the default', async () => {
    await withServer(
      [
        makeRoute(
          'POST',
          '/login',
          defineHandler(() => 'ok', { maxBodySize: 8 }),
        ),
      ],
      async (base) => {
        const res = await fetch(`${base}/login`, { method: 'POST', body: 'x'.repeat(64) });
        strictEqual(res.status, 413);
        await res.body?.cancel();
      },
    );
  });

  it('answers an over-cap body with 413 carrying the cors policy headers', async () => {
    useMiddleware().registerGlobal(
      'global-cors',
      cors({ origin: 'https://app.example.com', credentials: true }),
    );
    await withServer(
      [
        makeRoute(
          'POST',
          '/upload',
          defineHandler(() => 'ok', { maxBodySize: 8 }),
        ),
      ],
      async (base) => {
        const res = await fetch(`${base}/upload`, {
          method: 'POST',
          headers: { origin: 'https://app.example.com' },
          body: 'x'.repeat(64),
        });
        strictEqual(res.status, 413);
        strictEqual(res.headers.get('access-control-allow-origin'), 'https://app.example.com');
        strictEqual(res.headers.get('access-control-allow-credentials'), 'true');
        await res.body?.cancel();
      },
    );
  });

  it('lets a route handlerTimeout override opt out of the global deadline', async () => {
    await withServer(
      [
        makeRoute(
          'GET',
          '/slow',
          defineHandler(async () => {
            await sleep(60);
            return 'done';
          }),
        ),
        makeRoute(
          'GET',
          '/patient',
          defineHandler(
            async () => {
              await sleep(60);
              return 'done';
            },
            { handlerTimeout: false },
          ),
        ),
      ],
      async (base) => {
        const timed = await fetch(`${base}/slow`);
        strictEqual(timed.status, 503);
        await timed.body?.cancel();

        const patient = await fetch(`${base}/patient`);
        strictEqual(await patient.text(), 'done');
      },
      { handlerTimeout: 20 },
    );
  });
});

describe('allowed hosts', () => {
  it('refuses a Host outside the allowlist with 400, allowing the apex and subdomains', async () => {
    await withServer(
      [makeRoute('GET', '/', () => 'ok')],
      async (base) => {
        strictEqual(await statusWithHost(base, 'example.com'), 200);
        strictEqual(await statusWithHost(base, 'api.example.com'), 200);
        strictEqual(await statusWithHost(base, 'a.b.example.com'), 200);
        strictEqual(await statusWithHost(base, 'evil.com'), 400);
      },
      { allowedHosts: ['example.com', '*.example.com'] },
    );
  });

  it('answers any host when the allowlist is empty', async () => {
    await withServer([makeRoute('GET', '/', () => 'ok')], async (base) => {
      strictEqual(await statusWithHost(base, 'anything.test'), 200);
    });
  });
});

describe('header size limit', () => {
  it('refuses an oversized request header block with 431', async () => {
    await withServer(
      [makeRoute('GET', '/', () => 'ok')],
      async (base) => {
        strictEqual(await statusWithHeaderOf(base, 100), 200);
        strictEqual(await statusWithHeaderOf(base, 8000), 431);
      },
      { maxHeaderSize: 2048 },
    );
  });
});

describe('base path', () => {
  it('mounts routes under the prefix and strips it before the handler', async () => {
    await withServer(
      [
        makeRoute('GET', '/users/[id]', () => ({
          id: useEvent().params.id,
          seen: useEvent().url.pathname,
        })),
      ],
      async (base) => {
        const res = await fetch(`${base}/api/users/42`);
        strictEqual(res.status, 200);
        deepStrictEqual(await res.json(), { id: '42', seen: '/users/42' });
      },
      { basePath: '/api' },
    );
  });

  it('answers a request outside the prefix with 404', async () => {
    await withServer(
      [makeRoute('GET', '/users', () => 'ok')],
      async (base) => {
        const res = await fetch(`${base}/users`);
        strictEqual(res.status, 404);
        await res.body?.cancel();
      },
      { basePath: '/api' },
    );
  });

  it('serves the mount root at the bare prefix', async () => {
    await withServer(
      [makeRoute('GET', '/', () => 'home')],
      async (base) => {
        strictEqual(await (await fetch(`${base}/api`)).text(), 'home');
      },
      { basePath: '/api' },
    );
  });

  it('accepts any slash variant of the configured prefix', async () => {
    await withServer(
      [makeRoute('GET', '/ping', () => 'pong')],
      async (base) => {
        strictEqual(await (await fetch(`${base}/api/ping`)).text(), 'pong');
      },
      { basePath: 'api/' },
    );
  });
});

describe('request signal', () => {
  it('aborts `useRequest().signal` when the client goes away mid-request', async () => {
    let entered!: (chunk: string) => void;
    const reading = new Promise<string>((resolve) => (entered = resolve));
    let reason: unknown;
    const route = makeRoute('POST', '/upload', async () => {
      const { body, signal } = useRequest();
      const { value } = await body!.getReader().read();
      entered(new TextDecoder().decode(value));
      await once(signal, 'abort');
      reason = signal.reason;
      return null;
    });

    await withServer([route], async (base) => {
      const req = request(`${base}/upload`, { method: 'POST' }).on('error', () => {});
      req.write('Thrall');
      strictEqual(await reading, 'Thrall');
      req.destroy();
      await waitFor(() => !isUndefined(reason));
      strictEqual((reason as DOMException).name, 'AbortError');
    });
  });

  it('finds `useRequest().signal` aborted when first read after the client went away', async () => {
    let entered!: () => void;
    const reading = new Promise<void>((resolve) => (entered = resolve));
    let gone!: () => void;
    const left = new Promise<void>((resolve) => (gone = resolve));
    let aborted: boolean | undefined;
    const route = makeRoute('POST', '/late-read', async () => {
      const { body } = useRequest();
      await body!.getReader().read();
      entered();
      await left;
      aborted = useRequest().signal.aborted;
      return null;
    });

    await withServer([route], async (base, _gate, server) => {
      server.on('request', (_req, res: ServerResponse) => res.once('close', () => gone()));
      const req = request(`${base}/late-read`, { method: 'POST' }).on('error', () => {});
      req.write('Varian');
      await reading;
      req.destroy();
      await waitFor(() => !isUndefined(aborted));
      strictEqual(aborted, true);
    });
  });

  it('leaves `useRequest().signal` unaborted once the response finished', async () => {
    let signal: AbortSignal | undefined;
    const route = makeRoute('GET', '/done', () => {
      signal = useRequest().signal;
      return 'ok';
    });

    await withServer([route], async (base, _gate, server) => {
      let closed = false;
      server.on('request', (_req, res: ServerResponse) => res.once('close', () => (closed = true)));
      const res = await fetch(`${base}/done`);
      strictEqual(await res.text(), 'ok');
      await waitFor(() => closed);
      strictEqual(closed, true);
      strictEqual(signal?.aborted, false);
    });
  });

  it('drops the answer to a client that already left, printing nothing', async () => {
    const printed: string[] = [];
    usePrinter().configure({ stream: { write: (chunk) => void printed.push(chunk) } });
    let entered!: () => void;
    const waiting = new Promise<void>((resolve) => (entered = resolve));
    const route = makeRoute('GET', '/late', async () => {
      const { signal } = useRequest();
      entered();
      await once(signal, 'abort');
      return { hero: 'Jaina' };
    });

    try {
      await withServer([route], async (base, gate) => {
        const req = request(`${base}/late`).on('error', () => {});
        req.end();
        await waiting;
        req.destroy();
        await waitFor(() => gate.pending === 0);
        strictEqual(gate.pending, 0);
      });
    } finally {
      usePrinter().configure({ stream: { write() {} } });
    }
    deepStrictEqual(printed, []);
  });

  it('prints nothing for work the request signal aborted after the client left', async () => {
    const printed: string[] = [];
    usePrinter().configure({ stream: { write: (chunk) => void printed.push(chunk) } });
    let entered!: () => void;
    const waiting = new Promise<void>((resolve) => (entered = resolve));
    const route = makeRoute('GET', '/report', async () => {
      const { signal } = useRequest();
      entered();
      await once(signal, 'abort');
      signal.throwIfAborted();
      return null;
    });

    try {
      await withServer([route], async (base, gate) => {
        const req = request(`${base}/report`).on('error', () => {});
        req.end();
        await waiting;
        req.destroy();
        await waitFor(() => gate.pending === 0);
        strictEqual(gate.pending, 0);
      });
    } finally {
      usePrinter().configure({ stream: { write() {} } });
    }
    deepStrictEqual(printed, []);
  });
});
