import type { AddressInfo } from 'node:net';

import { strictEqual } from 'node:assert';
import { once } from 'node:events';
import { request } from 'node:http';
import { before, describe, it } from 'node:test';

import type { AnyHandler, CreateServerOptions, Route } from '../../../src/ohne/index.ts';
import type { Gate, HTTPMethod } from '../../../src/utils/index.ts';

import {
  createRouter,
  createServer,
  defineHandler,
  useEvent,
  usePrinter,
  waitUntil,
} from '../../../src/ohne/index.ts';
import { sleep } from '../../../src/utils/index.ts';

function makeRoute(method: HTTPMethod, pattern: string, handler: AnyHandler): Route {
  return { method, pattern, file: `${pattern}.ts`, layer: 'test', handler };
}

async function waitFor(condition: () => boolean): Promise<void> {
  for (let i = 0; i < 200 && !condition(); i++) await sleep(5);
}

async function withServer(
  routes: Route[],
  run: (base: string, gate: Gate) => Promise<void>,
  options: CreateServerOptions = {},
): Promise<void> {
  const { server, gate } = createServer(createRouter(routes), options);
  server.listen(0);
  await once(server, 'listening');
  const { port } = server.address() as AddressInfo;
  try {
    await run(`http://localhost:${port}`, gate);
  } finally {
    server.close();
    server.closeAllConnections();
  }
}

before(() => {
  usePrinter().configure({ stream: { write() {} } });
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
