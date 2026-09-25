import type { AddressInfo } from 'node:net';

import { deepStrictEqual, ok, strictEqual } from 'node:assert';
import { subscribe, unsubscribe } from 'node:diagnostics_channel';
import { EventEmitter, once } from 'node:events';
import { createServer } from 'node:http';
import { createServer as createNetServer, type Server, type Socket } from 'node:net';
import { after, describe, it } from 'node:test';
import { createServer as createTLSServer } from 'node:tls';

import { useEnv } from '../../../../src/ohne/env/use-env.ts';
import { dispatch } from '../../../../src/ohne/http/dispatch.ts';
import { createRouter } from '../../../../src/ohne/http/router.ts';
import { createServer as createAPIServer } from '../../../../src/ohne/http/server.ts';
import { DEFAULTS } from '../../../../src/ohne/layers/config.ts';
import { useLayers } from '../../../../src/ohne/layers/use-layers.ts';
import { usePrinter } from '../../../../src/ohne/printer/use-printer.ts';
import { queryUntyped } from '../../../../src/ohne/query/query.ts';
import { useRoles } from '../../../../src/ohne/roles/use-roles.ts';
import { getRouteOptions } from '../../../../src/ohne/routes/route-options.ts';
import fetchPost from '../../../../src/uploads/api/uploads/fetch.post.ts';
import { freePort } from '../../../../src/utils/net/free-port.ts';
import { DALARAN_CERT, DALARAN_KEY } from '../../../utils/net/_certificate.ts';
import { bytes, call, errorsOf, route, storage, stream, text, userWith } from '../../_fixture.ts';

useEnv().set('UPLOADS_SECRET', 'secret');

const LAYER = '/uploads-fetch';

const BODY = 'For the Horde';

/**
 * Every path the server was asked for, in order, so a refusal can prove nothing was sent.
 */
const hits: string[] = [];

/**
 * Every `ip:port` a client socket began to connect to, in order, so a refusal can prove nothing was dialed.
 */
const dials: string[] = [];

/**
 * Answers the `/hold` requests the server keeps waiting, oldest first.
 */
const holding: (() => void)[] = [];

/**
 * Emits `held` whenever a `/hold` request starts waiting, and a path when its client hangs up early.
 */
const events = new EventEmitter();

const server = createServer((req, res) => {
  const path = new URL(req.url ?? '/', 'http://x').pathname;
  hits.push(path);
  res.on('close', () => {
    if (!res.writableFinished) events.emit(path);
  });
  const answer = (): void => {
    res.writeHead(200, { 'content-type': 'text/plain', 'content-length': BODY.length }).end(BODY);
  };
  if (path === '/hold') {
    holding.push(answer);
    events.emit('held');
  } else if (path === '/stall') {
    res.writeHead(200, { 'content-type': 'text/plain' });
    res.write('For the');
  } else answer();
});
server.listen(0, '127.0.0.1');
await once(server, 'listening');
const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
subscribe('net.client.socket', recordDials);

after(() => {
  unsubscribe('net.client.socket', recordDials);
  server.closeAllConnections();
  server.close();
});

const fetchRoute = route('POST', '/uploads/fetch', fetchPost);
useRoles().register('uploads-fetcher', {
  name: 'uploads-fetcher',
  role: { capabilities: ['collection.Uploads.create', 'uploads.fetch'] },
});
const thrall = await userWith('thrall@example.com', ['uploads-fetcher']);
const creator = await userWith('jaina@example.com', ['uploads-admin']);
const nobody = await userWith('peon@example.com', []);

function post(bearer: string | undefined, json: unknown): Promise<Response> {
  return call(fetchRoute, '/uploads/fetch', {}, { bearer, json });
}

/**
 * Runs `run` with `uploads.fetch` stacked on top.
 */
async function withFetch(
  fetch: { allow?: string[]; timeout?: string },
  run: () => Promise<void>,
): Promise<void> {
  useLayers().add({ path: LAYER, input: { uploads: { fetch } } });
  try {
    await run();
  } finally {
    useLayers().remove(LAYER);
  }
}

/**
 * Runs `run` with loopback fetchable, as the positive cases need.
 */
function withLoopback(run: () => Promise<void>): Promise<void> {
  return withFetch({ allow: ['127.0.0.1/32', '::1/128'] }, run);
}

/**
 * Starts `server` on a free loopback port, resolving the port.
 */
async function listen(server: Server): Promise<number> {
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return (server.address() as AddressInfo).port;
}

/**
 * Resolves once `count` `/hold` requests are waiting on the server.
 */
async function held(count: number): Promise<void> {
  while (holding.length < count) await once(events, 'held');
}

/**
 * Records every connection attempt of a new client socket into `dials`.
 */
function recordDials(message: unknown): void {
  const { socket } = message as { socket: Socket };
  socket.on('connectionAttempt', (ip: string, port: number) => dials.push(`${ip}:${port}`));
}

/**
 * Posts `json` for `bearer` from a client that goes away when `signal` aborts.
 */
function postUntil(bearer: string, json: unknown, signal: AbortSignal): Promise<Response> {
  const request = new Request('http://x.test/uploads/fetch', {
    method: 'POST',
    headers: { authorization: `Bearer ${bearer}`, 'content-type': 'application/json' },
    body: JSON.stringify(json),
    signal,
  });
  return dispatch(fetchRoute, request, new URL(request.url), {}).then(({ response }) => response);
}

describe('POST /uploads/fetch', () => {
  it('fetches the URL into a file and answers 201 with the record', async () => {
    await withLoopback(async () => {
      const response = await post(thrall, {
        url: `${origin}/orgrimmar/Horde.txt`,
        directory: 'Kalimdor',
      });
      strictEqual(response.status, 201);
      const record = (await response.json()) as Record<string, unknown>;
      strictEqual(record.path, 'kalimdor/horde.txt');
      strictEqual(record.type, 'text/plain');
      strictEqual(record.size, BODY.length);
      strictEqual(text(storage.objects.get('kalimdor/horde.txt')), BODY);
      const user = await queryUntyped('Users').where({ email: 'thrall@example.com' }).findFirst();
      strictEqual(record.author, user?.UUID);
    });
  });

  it('names the file from the body when given', async () => {
    await withLoopback(async () => {
      const response = await post(thrall, { url: `${origin}/x.txt`, name: 'Lok Tar.txt' });
      strictEqual(response.status, 201);
      strictEqual(((await response.json()) as { name: string }).name, 'lok-tar.txt');
    });
  });

  it('401s without a user and 403s without uploads.fetch, sending nothing', async () => {
    await withLoopback(async () => {
      const before = hits.length;
      const json = { url: `${origin}/denied.txt` };
      strictEqual((await post(undefined, json)).status, 401);
      strictEqual((await post(nobody, json)).status, 403);
      strictEqual((await post(creator, json)).status, 403);
      strictEqual(hits.length, before);
    });
  });

  it('400s a url, directory, or name that is not a string', async () => {
    await withLoopback(async () => {
      const before = hits.length;
      const url = `${origin}/bad.txt`;
      for (const json of [
        {},
        { url: 42 },
        { url, directory: 7 },
        { url, directory: null },
        { url, name: false },
        [url],
      ]) {
        strictEqual((await post(thrall, json)).status, 400, JSON.stringify(json));
      }
      strictEqual(hits.length, before);
    });
  });

  it('422s a loopback URL on port 80 that uploads.fetch.allow does not admit, dialing nothing', async () => {
    dials.length = 0;
    const response = await post(thrall, { url: 'http://127.0.0.1/inside.txt' });
    strictEqual(response.status, 422);
    deepStrictEqual(errorsOf(await response.json()), { url: 'uploads.errors.urlUnreachable' });
    deepStrictEqual(dials, []);
  });

  it('429s a user already running two fetches, and frees the permits after', async () => {
    await withLoopback(async () => {
      const running = [
        post(thrall, { url: `${origin}/hold`, directory: 'held' }),
        post(thrall, { url: `${origin}/hold`, directory: 'held' }),
      ];
      await held(2);
      strictEqual((await post(thrall, { url: `${origin}/third.txt` })).status, 429);
      for (const answer of holding.splice(0)) answer();
      deepStrictEqual(
        (await Promise.all(running)).map((response) => response.status),
        [201, 201],
      );
      strictEqual((await post(thrall, { url: `${origin}/after.txt` })).status, 201);
    });
  });

  it('429s once the process runs eight fetches, whoever asks', async () => {
    const fetchers = await Promise.all(
      ['garrosh', 'rexxar', 'baine', 'voljin', 'cairne'].map((name) =>
        userWith(`${name}@example.com`, ['uploads-fetcher']),
      ),
    );
    await withLoopback(async () => {
      const running = fetchers
        .slice(0, 4)
        .flatMap((bearer) => [
          post(bearer, { url: `${origin}/hold`, directory: 'crowd' }),
          post(bearer, { url: `${origin}/hold`, directory: 'crowd' }),
        ]);
      await held(8);
      strictEqual((await post(fetchers[4], { url: `${origin}/ninth.txt` })).status, 429);
      for (const answer of holding.splice(0)) answer();
      for (const response of await Promise.all(running)) strictEqual(response.status, 201);
    });
  });

  it('aborts the fetch when the client goes away', { timeout: 5000 }, async () => {
    await withLoopback(async () => {
      const controller = new AbortController();
      const hungUp = once(events, '/stall');
      const pending = postUntil(
        thrall,
        { url: `${origin}/stall`, directory: 'gone' },
        controller.signal,
      );
      while (!hits.includes('/stall')) await once(server, 'request');
      controller.abort();
      await hungUp;
      strictEqual((await pending).status, 422);
      strictEqual(await queryUntyped('Uploads').where({ directory: 'gone' }).exists(), false);
    });
  });

  it('frees a permit once its client goes away, so the next fetch is no 429', async () => {
    await withLoopback(async () => {
      const controller = new AbortController();
      const json = { url: `${origin}/hold`, directory: 'held' };
      const left = postUntil(thrall, json, controller.signal);
      const staying = post(thrall, json);
      await held(2);
      controller.abort();
      strictEqual((await post(thrall, { url: `${origin}/next.txt` })).status, 201);
      for (const answer of holding.splice(0)) answer();
      strictEqual((await staying).status, 201);
      strictEqual((await left).status, 422);
    });
  });

  it('runs without a handler deadline, so no 503 answers a fetch that still commits', () => {
    strictEqual(getRouteOptions(fetchPost)?.handlerTimeout, false);
  });

  it('413s a JSON body past the API default before any fetch', async () => {
    const api = createAPIServer(createRouter([fetchRoute]), {
      maxBodySize: DEFAULTS.api.maxBodySize,
    });
    const port = await listen(api.server);
    try {
      await withLoopback(async () => {
        const before = hits.length;
        const response = await fetch(`http://127.0.0.1:${port}/uploads/fetch`, {
          method: 'POST',
          headers: { authorization: `Bearer ${thrall}`, 'content-type': 'application/json' },
          body: JSON.stringify({ url: `${origin}/big.txt`, name: 'a'.repeat(2 * 1024 * 1024) }),
        });
        strictEqual(response.status, 413);
        strictEqual(hits.length, before);
      });
    } finally {
      api.server.closeAllConnections();
      api.server.close();
    }
  });

  it('400s a URL past 8 KiB, sending nothing', async () => {
    await withLoopback(async () => {
      const before = hits.length;
      const response = await post(thrall, { url: `${origin}/${'a'.repeat(9 * 1024)}` });
      strictEqual(response.status, 400);
      strictEqual(hits.length, before);
    });
  });

  it('refuses a simple cross-site request before any fetch', async () => {
    await withLoopback(async () => {
      const before = hits.length;
      const url = `${origin}/csrf.png`;
      const plain = await call(
        fetchRoute,
        '/uploads/fetch',
        {},
        {
          bearer: thrall,
          body: stream(bytes(JSON.stringify({ url }))),
          headers: { 'content-type': 'text/plain' },
        },
      );
      strictEqual(plain.status, 415);
      const query = await call(
        fetchRoute,
        `/uploads/fetch?url=${encodeURIComponent(url)}`,
        {},
        { bearer: thrall, json: {} },
      );
      strictEqual(query.status, 400);
      strictEqual(hits.length, before);
    });
  });

  it('answers every failure before a response with one identical 422', async () => {
    const bodies: string[] = [];
    const send = async (url: string): Promise<void> => {
      const response = await post(thrall, { url });
      strictEqual(response.status, 422, url);
      bodies.push(await response.text());
    };

    dials.length = 0;
    await withFetch({ timeout: '5s' }, async () => {
      await send('http://127.0.0.1/');
      await send('http://localhost/');
      await send('http://no-such-host.invalid/');
    });
    deepStrictEqual(dials, []);

    const truncating = createNetServer((socket) => {
      socket.once('data', () => {
        socket.end(
          'HTTP/1.1 200 OK\r\ncontent-type: text/plain\r\ncontent-length: 100\r\n\r\nFor the Ho',
        );
      });
    });
    const tls = createTLSServer({ cert: DALARAN_CERT, key: DALARAN_KEY }, (socket) => socket.end());
    const ports = [
      await freePort(0, { host: '127.0.0.1' }),
      await listen(truncating),
      await listen(tls),
    ];
    try {
      await withFetch({ allow: ['127.0.0.1/32'], timeout: '5s' }, async () => {
        await send(`http://127.0.0.1:${ports[0]}/`);
        await send(`http://127.0.0.1:${ports[1]}/`);
        await send(`https://127.0.0.1:${ports[2]}/`);
      });
    } finally {
      truncating.close();
      tls.close();
    }

    strictEqual(new Set(bodies).size, 1);
    for (const needle of ['dalaran', '127.0.0.1', 'invalid', ...ports]) {
      ok(!bodies[0].includes(String(needle)), `${needle} in ${bodies[0]}`);
    }
    strictEqual(await queryUntyped('Uploads').where({ name: 'file.txt' }).exists(), false);
  });

  it('never prints a URL or what it carries, even under DEBUG', async () => {
    const secrets = ['SECRET_PW', 'SECRET_PATH', 'S1', 'SECRET_SIG'];
    let written = '';
    useEnv().set('DEBUG', true);
    usePrinter().configure({ stream: { write: (chunk: string) => ((written += chunk), true) } });
    try {
      await withFetch({ timeout: '5s' }, async () => {
        for (const url of [
          'http://user:SECRET_PW@no-such-host.invalid/p',
          'http://user:SECRET_PW@[::1',
          'http://no-such-host.invalid/SECRET_PATH;jsessionid=S1?X-Amz-Signature=SECRET_SIG',
        ]) {
          const response = await post(thrall, { url });
          strictEqual(response.status, 422, url);
          const body = await response.text();
          for (const secret of secrets) ok(!body.includes(secret), `${secret} in ${body}`);
        }
      });
    } finally {
      usePrinter().configure({ stream: { write: () => true } });
      useEnv().unset('DEBUG');
    }
    for (const secret of secrets) ok(!written.includes(secret), `${secret} in ${written}`);
  });
});
