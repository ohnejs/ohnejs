import type { AddressInfo } from 'node:net';

import { deepStrictEqual, ok, rejects, strictEqual } from 'node:assert';
import { once } from 'node:events';
import { createServer, type IncomingMessage, request, type RequestListener } from 'node:http';
import { connect } from 'node:net';
import { text } from 'node:stream/consumers';
import { describe, it } from 'node:test';
import { setImmediate, setTimeout as delay } from 'node:timers/promises';

import {
  clientIP,
  hook,
  HTTPError,
  sendResponse,
  toRequest,
  toURL,
  useHooks,
} from '../../../src/ohne/index.ts';
import { createCIDRMatcher } from '../../../src/utils/net/index.ts';
import { collectGarbage } from './_gc.ts';

async function withServer(
  handler: RequestListener,
  run: (base: string) => Promise<void>,
): Promise<void> {
  const server = createServer(handler);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const { port } = server.address() as AddressInfo;
  try {
    await run(`http://127.0.0.1:${port}`);
  } finally {
    server.close();
    await once(server, 'close');
  }
}

/**
 * Resolves once `predicate` holds, failing after `timeout` milliseconds, so a stalled connection fails its test.
 */
async function until(predicate: () => boolean, timeout = 2000): Promise<void> {
  const deadline = Date.now() + timeout;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error('until timed out');
    await delay(10);
  }
}

/**
 * Opens a raw, half-open connection to `base`, collecting what the server sends and the errors it causes.
 */
async function dial(base: string) {
  const { hostname, port } = new URL(base);
  const socket = connect({ port: Number(port), host: hostname, allowHalfOpen: true });
  const seen = { text: '', ended: false, errors: [] as string[] };
  socket.on('error', (error: NodeJS.ErrnoException) => seen.errors.push(error.code ?? 'error'));
  socket.on('data', (chunk: Buffer) => (seen.text += chunk.toString('latin1')));
  socket.on('end', () => (seen.ended = true));
  await once(socket, 'connect');
  return { socket, seen };
}

/**
 * Sends `head` and `body` on a raw connection to `base` and waits for the first answer.
 * `close` says whether the answer announced `Connection: close`, and `ended` whether the server then ended.
 * `reused` says whether a follow-up `GET` was answered `200` on the connection instead.
 */
async function exchange(
  base: string,
  head: string,
  body: Uint8Array | string = '',
): Promise<{ status: string | undefined; close: boolean; ended: boolean; reused: boolean }> {
  const { socket, seen } = await dial(base);
  socket.write(head);
  socket.write(body);
  try {
    await until(() => seen.text.includes('\r\n\r\n'));
    const answer = seen.text.slice(0, seen.text.indexOf('\r\n\r\n'));
    const status = /^HTTP\/1\.1 (\d+)/.exec(answer)?.[1];
    const close = /^connection: close$/im.test(answer);
    await delay(150);
    if (seen.ended) return { status, close, ended: true, reused: false };
    socket.write('GET / HTTP/1.1\r\nHost: x\r\n\r\n');
    await until(() => seen.text.split('HTTP/1.1 ').length > 2);
    return {
      status,
      close,
      ended: false,
      reused: seen.text.split('HTTP/1.1 ')[2].startsWith('200'),
    };
  } finally {
    socket.destroy();
  }
}

describe('toRequest', () => {
  it('assembles the URL from target and Host, carries headers, GET is bodyless', async () => {
    await withServer(
      async (req, res) => {
        const request = toRequest(req);
        await sendResponse(
          res,
          Response.json({
            method: request.method,
            url: request.url,
            foo: request.headers.get('x-foo'),
            hasBody: request.body !== null,
          }),
        );
      },
      async (base) => {
        const res = await fetch(`${base}/users/42?q=1`, { headers: { 'x-foo': 'bar' } });
        const data = (await res.json()) as {
          method: string;
          url: string;
          foo: string;
          hasBody: boolean;
        };
        strictEqual(data.method, 'GET');
        strictEqual(new URL(data.url).pathname, '/users/42');
        strictEqual(new URL(data.url).search, '?q=1');
        strictEqual(data.foo, 'bar');
        strictEqual(data.hasBody, false);
      },
    );
  });

  it('streams a request body for non-bodyless methods', async () => {
    await withServer(
      async (req, res) => {
        const request = toRequest(req);
        await sendResponse(res, new Response((await request.text()).toUpperCase()));
      },
      async (base) => {
        const res = await fetch(base, { method: 'POST', body: 'hello' });
        strictEqual(await res.text(), 'HELLO');
      },
    );
  });

  it('passes a body within maxBodySize', async () => {
    await withServer(
      async (req, res) => {
        const request = toRequest(req, { maxBodySize: 64 });
        await sendResponse(res, new Response((await request.text()).toUpperCase()));
      },
      async (base) => {
        const res = await fetch(base, { method: 'POST', body: 'hello' });
        strictEqual(await res.text(), 'HELLO');
      },
    );
  });

  it('passes a body of exactly maxBodySize', async () => {
    await withServer(
      async (req, res) => {
        const request = toRequest(req, { maxBodySize: 5 });
        await sendResponse(res, new Response((await request.text()).toUpperCase()));
      },
      async (base) => {
        const res = await fetch(base, { method: 'POST', body: 'hello' });
        strictEqual(res.status, 200);
        strictEqual(await res.text(), 'HELLO');
      },
    );
  });

  it('aborts a streamed body that overruns the cap with 413', async () => {
    await withServer(
      async (req, res) => {
        const request = toRequest(req, { maxBodySize: 4 });
        try {
          await request.text();
          await sendResponse(res, new Response(null, { status: 200 }));
        } catch (error) {
          await sendResponse(
            res,
            new Response(null, { status: error instanceof HTTPError ? error.status : 500 }),
          );
        }
      },
      async (base) => {
        const stream = new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(new TextEncoder().encode('hello world'));
            controller.close();
          },
        });
        const res = await fetch(base, {
          method: 'POST',
          body: stream,
          duplex: 'half',
        } as RequestInit);
        strictEqual(res.status, 413);
      },
    );
  });

  it('follows `signal`, leaving the body readable once it aborts', async () => {
    await withServer(
      async (req, res) => {
        const controller = new AbortController();
        const request = toRequest(req, { signal: controller.signal });
        controller.abort();
        const body = await request.text();
        await sendResponse(res, new Response(`${request.signal.aborted} ${body}`));
      },
      async (base) => {
        const res = await fetch(base, { method: 'POST', body: 'Sylvanas' });
        strictEqual(await res.text(), 'true Sylvanas');
      },
    );
  });

  it('lets a dropped request collect while its source `signal` lives', async () => {
    await withServer(
      async (req, res) => {
        const controller = new AbortController();
        const ref = new WeakRef(toRequest(req, { signal: controller.signal }));
        await collectGarbage();
        await sendResponse(res, new Response(String(ref.deref() === undefined)));
      },
      async (base) => {
        strictEqual(await (await fetch(base)).text(), 'true');
      },
    );
  });

  it('runs `onFirstRead` once, when the metered body is first read', async () => {
    await withServer(
      async (req, res) => {
        let reads = 0;
        const request = toRequest(req, { maxBodySize: 64, onFirstRead: () => reads++ });
        await setImmediate();
        const before = reads;
        const text = await request.text();
        await sendResponse(res, Response.json({ before, after: reads, text }));
      },
      async (base) => {
        const res = await fetch(base, { method: 'POST', body: 'Varian' });
        deepStrictEqual(await res.json(), { before: 0, after: 1, text: 'Varian' });
      },
    );
  });

  it('honors X-Forwarded-Proto and Host when the peer is trusted', async () => {
    await withServer(
      async (req, res) => {
        const request = toRequest(req, { url: toURL(req, () => true) });
        await sendResponse(res, new Response(request.url));
      },
      async (base) => {
        const res = await fetch(`${base}/p`, {
          headers: { 'x-forwarded-proto': 'https', 'x-forwarded-host': 'example.com' },
        });
        strictEqual(await res.text(), 'https://example.com/p');
      },
    );
  });

  it('ignores forwarding headers when the peer is not trusted', async () => {
    await withServer(
      async (req, res) => {
        const request = toRequest(req, { url: toURL(req, () => false) });
        const url = new URL(request.url);
        await sendResponse(res, new Response(`${url.protocol}//${url.host}`));
      },
      async (base) => {
        const res = await fetch(`${base}/p`, {
          headers: { 'x-forwarded-proto': 'https', 'x-forwarded-host': 'evil.com' },
        });
        strictEqual(await res.text(), `http://${new URL(base).host}`);
      },
    );
  });

  it('ignores a spoofed Forwarded origin, honoring X-Forwarded-* when the peer is trusted', async () => {
    await withServer(
      async (req, res) => {
        const request = toRequest(req, { url: toURL(req, () => true) });
        await sendResponse(res, new Response(request.url));
      },
      async (base) => {
        const res = await fetch(`${base}/p`, {
          headers: {
            forwarded: 'host=evil.example;proto=http',
            'x-forwarded-host': 'example.com',
            'x-forwarded-proto': 'https',
          },
        });
        strictEqual(await res.text(), 'https://example.com/p');
      },
    );
  });

  it('takes only the path and query from a `//host` or absolute-form target', async () => {
    await withServer(
      async (req, res) => {
        await sendResponse(res, new Response(toURL(req).href));
      },
      async (base) => {
        const { port } = new URL(base);
        const hrefs: string[] = [];
        for (const path of ['//evil.com/p?q=1', 'http://evil.com/p?q=1']) {
          const req = request({ port, path, headers: { host: 'app.example' } });
          req.end();
          const [res] = await once(req, 'response');
          hrefs.push(await text(res));
        }
        deepStrictEqual(hrefs, ['http://app.example//evil.com/p?q=1', 'http://app.example/p?q=1']);
      },
    );
  });

  it('keeps a path in the Host header out of the URL path', async () => {
    await withServer(
      async (req, res) => {
        await sendResponse(res, new Response(toURL(req).href));
      },
      async (base) => {
        const { port } = new URL(base);
        const req = request({ port, path: '/users?q=1', headers: { host: 'app.example/admin' } });
        req.end();
        const [res] = await once(req, 'response');
        strictEqual(await text(res), 'http://app.example/users?q=1');
      },
    );
  });

  it('refuses a malformed Host or target with 400', async () => {
    await withServer(
      async (req, res) => {
        try {
          toURL(req);
          await sendResponse(res, new Response(null, { status: 200 }));
        } catch (error) {
          const status = error instanceof HTTPError ? error.status : 500;
          await sendResponse(res, new Response(null, { status }));
        }
      },
      async (base) => {
        const { port } = new URL(base);
        const statuses: number[] = [];
        for (const [path, host] of [
          ['/', '[zz]'],
          ['/', 'localhost:99999'],
          ['http://[zz]/p', 'app.example'],
        ]) {
          const req = request({ port, path, headers: { host } });
          req.end();
          const [res] = await once(req, 'response');
          res.resume();
          statuses.push(res.statusCode);
        }
        deepStrictEqual(statuses, [400, 400, 400]);
      },
    );
  });

  it('appends every value of an array-valued header', async () => {
    await withServer(
      async (req, res) => {
        const request = toRequest(req);
        await sendResponse(res, new Response(request.headers.get('set-cookie')));
      },
      async (base) => {
        const { port } = new URL(base);
        const req = request({ port, method: 'GET', headers: { 'set-cookie': ['a=1', 'b=2'] } });
        req.end();
        const [res] = await once(req, 'response');
        const chunks: Buffer[] = [];
        for await (const chunk of res) chunks.push(chunk);
        strictEqual(Buffer.concat(chunks).toString(), 'a=1, b=2');
      },
    );
  });
});

describe('clientIP', () => {
  it('walks X-Forwarded-For to the first untrusted address when the peer is trusted', async () => {
    await withServer(
      async (req, res) => {
        const trusted = createCIDRMatcher(['10.0.0.0/8', '127.0.0.1', '::1']);
        await sendResponse(res, new Response(clientIP(req, trusted)));
      },
      async (base) => {
        const res = await fetch(base, {
          headers: { 'x-forwarded-for': '6.6.6.6, 203.0.113.9, 10.0.0.1' },
        });
        strictEqual(await res.text(), '203.0.113.9');
      },
    );
  });

  it('returns the socket peer when no proxy is trusted', async () => {
    await withServer(
      async (req, res) => {
        await sendResponse(res, new Response(clientIP(req)));
      },
      async (base) => {
        const res = await fetch(base, { headers: { 'x-forwarded-for': '203.0.113.9' } });
        const ip = await res.text();
        ok(ip === '127.0.0.1' || ip === '::1');
      },
    );
  });

  it('ignores a spoofed Forwarded header, honoring X-Forwarded-For', async () => {
    await withServer(
      async (req, res) => {
        const trusted = createCIDRMatcher(['10.0.0.0/8', '127.0.0.1', '::1']);
        await sendResponse(res, new Response(clientIP(req, trusted)));
      },
      async (base) => {
        const res = await fetch(base, {
          headers: { forwarded: 'for=6.6.6.6', 'x-forwarded-for': '203.0.113.9' },
        });
        strictEqual(await res.text(), '203.0.113.9');
      },
    );
  });
});

describe('sendResponse', () => {
  it('copies status and headers', async () => {
    await withServer(
      async (_req, res) => {
        await sendResponse(res, new Response('x', { status: 418, headers: { 'x-test': 'yes' } }));
      },
      async (base) => {
        const res = await fetch(base);
        strictEqual(res.status, 418);
        strictEqual(res.headers.get('x-test'), 'yes');
        strictEqual(await res.text(), 'x');
      },
    );
  });

  it('sends the standard reason phrase for the status, independent of the body message', async () => {
    await withServer(
      async (_req, res) => {
        const body = JSON.stringify({ statusCode: 404, message: 'User not found' });
        await sendResponse(res, new Response(body, { status: 404 }));
      },
      async (base) => {
        const res = await fetch(base);
        strictEqual(res.status, 404);
        strictEqual(res.statusText, 'Not Found');
        strictEqual(JSON.parse(await res.text()).message, 'User not found');
      },
    );
  });

  it('stamps the CORS default onto a Response with immutable headers', async () => {
    await withServer(
      async (_req, res) => {
        await sendResponse(res, Response.redirect('http://example.com/tome', 302));
      },
      async (base) => {
        const res = await fetch(base, { redirect: 'manual' });
        strictEqual(res.status, 302);
        strictEqual(res.headers.get('location'), 'http://example.com/tome');
        strictEqual(res.headers.get('access-control-allow-origin'), '*');
      },
    );
  });

  it('ends the socket with no body for a bodyless response', async () => {
    await withServer(
      async (_req, res) => {
        await sendResponse(res, new Response(null, { status: 204 }));
      },
      async (base) => {
        const res = await fetch(base);
        strictEqual(res.status, 204);
        strictEqual(await res.text(), '');
      },
    );
  });

  it('cancels the body of a HEAD answer unread, keeping its headers', async () => {
    let pulls = 0;
    let cancelled = false;
    await withServer(
      async (_req, res) => {
        const stream = new ReadableStream<Uint8Array>({
          pull(controller) {
            if (++pulls === 100) controller.close();
            else controller.enqueue(new Uint8Array(64 * 1024));
          },
          cancel() {
            cancelled = true;
          },
        });
        await sendResponse(res, new Response(stream, { headers: { 'content-length': '999999' } }));
      },
      async (base) => {
        const res = await fetch(base, { method: 'HEAD' });
        strictEqual(res.status, 200);
        strictEqual(res.headers.get('content-length'), '999999');
      },
    );
    ok(cancelled);
    ok(pulls <= 1);
  });

  it('drops the answer to a client that already went away, cancelling its body', async () => {
    let cancelled = false;
    const dropped = Promise.withResolvers<void>();
    await withServer(
      async (_req, res) => {
        res.destroy();
        const stream = new ReadableStream<Uint8Array>({
          cancel() {
            cancelled = true;
          },
        });
        await sendResponse(res, new Response(stream)).then(dropped.resolve, dropped.reject);
      },
      async (base) => {
        await rejects(fetch(base));
        await dropped.promise;
      },
    );
    ok(cancelled);
  });

  it('pipes a streamed response body', async () => {
    await withServer(
      async (_req, res) => {
        const stream = new ReadableStream({
          start(controller) {
            controller.enqueue(new TextEncoder().encode('a'));
            controller.enqueue(new TextEncoder().encode('b'));
            controller.close();
          },
        });
        await sendResponse(res, new Response(stream));
      },
      async (base) => {
        const res = await fetch(base);
        strictEqual(await res.text(), 'ab');
      },
    );
  });

  it('runs the response:headers hook before writing the headers', async () => {
    hook('response:headers', (headers, response) => {
      headers.set('x-hooked', String(response.status));
    });
    try {
      await withServer(
        async (_req, res) => {
          await sendResponse(res, new Response('x', { status: 201 }));
        },
        async (base) => {
          const res = await fetch(base);
          strictEqual(res.headers.get('x-hooked'), '201');
        },
      );
    } finally {
      useHooks().clear();
    }
  });
});

describe('connection reuse', () => {
  const MB = 1024 * 1024;
  const DRAIN_LIMIT = 256 * 1024;
  const posting = (length: number, extra = ''): string =>
    `POST / HTTP/1.1\r\nHost: x\r\nContent-Length: ${length}\r\n${extra}\r\n`;
  const chunked = 'POST / HTTP/1.1\r\nHost: x\r\nTransfer-Encoding: chunked\r\n\r\n';

  /**
   * Answers a `GET` with `ok`, and anything else with `status` after `read` had its way with the request.
   */
  const handler =
    (
      status: number,
      read: (req: IncomingMessage) => Promise<unknown> = async () => {},
      headers?: Record<string, string>,
    ): RequestListener =>
    async (req, res) => {
      if (req.method === 'GET') return void (await sendResponse(res, new Response('ok')));
      await read(req);
      await sendResponse(res, new Response(null, { status, headers }));
    };

  /**
   * Reads the first chunk of the body, then cancels the rest.
   */
  const readPartway = async (req: IncomingMessage): Promise<void> => {
    const reader = toRequest(req).body!.getReader();
    await reader.read();
    await reader.cancel();
  };

  /**
   * Reads the first chunk of the body and leaves the rest unread, until the request stops flowing.
   */
  const readAndDrop = async (req: IncomingMessage): Promise<void> => {
    const reader = toRequest(req).body!.getReader();
    await reader.read();
    await until(() => req.isPaused());
  };

  /**
   * Answers with a body that reads the first chunk of the request body after the head went out, then cancels.
   */
  const abandonLate: RequestListener = async (req, res) => {
    if (req.method === 'GET') return void (await sendResponse(res, new Response('ok')));
    const reader = toRequest(req).body!.getReader();
    const answer = new ReadableStream<Uint8Array>({
      async pull(controller) {
        const { value } = await reader.read();
        controller.enqueue(new TextEncoder().encode(String(value?.byteLength)));
        await reader.cancel();
        controller.close();
      },
    });
    await sendResponse(res, new Response(answer));
  };

  /**
   * Sends `head` and part of its body, and after the answer keeps sending `rest` bytes, then reports how it ended.
   */
  const refuseWhileSending = async (base: string, head: string, rest = 2 * MB) => {
    const { socket, seen } = await dial(base);
    const closed = new Promise<boolean>((resolve) => socket.once('close', resolve));
    socket.write(head);
    socket.write(new Uint8Array(64 * 1024));
    await until(() => seen.ended);
    for (let sent = 0; sent < rest; sent += 64 * 1024) socket.write(new Uint8Array(64 * 1024));
    await delay(300);
    socket.end();
    const hadError = await closed;
    return { statuses: seen.text.match(/^HTTP\/1\.[01] \d+/gm), errors: seen.errors, hadError };
  };

  it('keeps the connection after a body read whole', async () => {
    await withServer(
      handler(200, (req) => toRequest(req).text()),
      async (base) => {
        deepStrictEqual(await exchange(base, posting(5), 'hello'), {
          status: '200',
          close: false,
          ended: false,
          reused: true,
        });
      },
    );
  });

  it('keeps the connection after a request without a body, answered at once', async () => {
    await withServer(handler(200), async (base) => {
      deepStrictEqual(await exchange(base, 'GET / HTTP/1.1\r\nHost: x\r\n\r\n'), {
        status: '200',
        close: false,
        ended: false,
        reused: true,
      });
    });
  });

  it('keeps the connection after a small body nobody read', async () => {
    await withServer(handler(401), async (base) => {
      deepStrictEqual(await exchange(base, posting(1024), new Uint8Array(1024)), {
        status: '401',
        close: false,
        ended: false,
        reused: true,
      });
    });
  });

  it('keeps the connection after a small body read partway and cancelled', async () => {
    await withServer(handler(422, readPartway), async (base) => {
      deepStrictEqual(await exchange(base, posting(64 * 1024), new Uint8Array(64 * 1024)), {
        status: '422',
        close: false,
        ended: false,
        reused: true,
      });
    });
  });

  it('keeps the connection after a small body abandoned once the answer started', async () => {
    await withServer(abandonLate, async (base) => {
      deepStrictEqual(await exchange(base, posting(64 * 1024), new Uint8Array(64 * 1024)), {
        status: '200',
        close: false,
        ended: false,
        reused: true,
      });
    });
  });

  it('drains a large body abandoned once a success started, since the client must finish it', async () => {
    await withServer(abandonLate, async (base) => {
      deepStrictEqual(await exchange(base, posting(MB), new Uint8Array(MB)), {
        status: '200',
        close: false,
        ended: false,
        reused: true,
      });
    });
  });

  it('drains a large body read partway before a success, since the client must finish it', async () => {
    await withServer(handler(201, readPartway), async (base) => {
      deepStrictEqual(await exchange(base, posting(MB), new Uint8Array(MB)), {
        status: '201',
        close: false,
        ended: false,
        reused: true,
      });
    });
  });

  it('drains a large body read partway and dropped uncancelled before a success', async () => {
    await withServer(handler(200, readAndDrop), async (base) => {
      deepStrictEqual(await exchange(base, posting(MB), new Uint8Array(MB)), {
        status: '200',
        close: false,
        ended: false,
        reused: true,
      });
    });
  });

  it('drains a large unread body after any status below 400', async () => {
    for (const status of [303, 399]) {
      await withServer(handler(status), async (base) => {
        deepStrictEqual(await exchange(base, posting(MB), new Uint8Array(MB)), {
          status: String(status),
          close: false,
          ended: false,
          reused: true,
        });
      });
    }
  });

  it('discards an unread body after an error status up to the drain limit, and closes past it', async () => {
    await withServer(handler(413), async (base) => {
      const at = await exchange(base, posting(DRAIN_LIMIT), new Uint8Array(DRAIN_LIMIT));
      const past = await exchange(base, posting(DRAIN_LIMIT + 1), new Uint8Array(64 * 1024));
      deepStrictEqual([at.reused, past.close], [true, true]);
    });
  });

  it('announces the close after a large body read partway and refused', async () => {
    await withServer(handler(400, readPartway), async (base) => {
      deepStrictEqual(await exchange(base, posting(MB), new Uint8Array(64 * 1024)), {
        status: '400',
        close: true,
        ended: true,
        reused: false,
      });
    });
  });

  it('announces the close after a streamed body overruns maxBodySize', async () => {
    const overrun = (req: IncomingMessage) => rejects(toRequest(req, { maxBodySize: 1024 }).text());
    await withServer(handler(413, overrun), async (base) => {
      const chunk = 'x'.repeat(64 * 1024);
      deepStrictEqual(
        await exchange(base, chunked, `${chunk.length.toString(16)}\r\n${chunk}\r\n`),
        {
          status: '413',
          close: true,
          ended: true,
          reused: false,
        },
      );
    });
  });

  it('announces the close rather than read a large unread body whole', async () => {
    await withServer(handler(413), async (base) => {
      deepStrictEqual(await exchange(base, posting(8 * MB), new Uint8Array(64 * 1024)), {
        status: '413',
        close: true,
        ended: true,
        reused: false,
      });
    });
  });

  it('settles an answer queued behind a slower one', async () => {
    const slow: RequestListener = async (req, res) => {
      if (req.method !== 'GET') return handler(422, readPartway)(req, res);
      await delay(300);
      await sendResponse(res, new Response('slow'));
    };
    await withServer(slow, async (base) => {
      deepStrictEqual(
        await refuseWhileSending(base, `GET / HTTP/1.1\r\nHost: x\r\n\r\n${posting(8 * MB)}`),
        { statuses: ['HTTP/1.1 200', 'HTTP/1.1 422'], errors: [], hadError: false },
      );
    });
  });

  it('keeps reading after the close, so a client still sending gets no reset', async () => {
    const closing = handler(422, async () => {}, { connection: 'close' });
    const heads = {
      announced: posting(8 * MB),
      'asked by the client': posting(8 * MB, 'Connection: close\r\n'),
      'HTTP/1.0': `POST / HTTP/1.0\r\nHost: x\r\nContent-Length: ${8 * MB}\r\n\r\n`,
    };
    for (const [name, head] of Object.entries(heads)) {
      await withServer(handler(422), async (base) => {
        deepStrictEqual(
          { name, ...(await refuseWhileSending(base, head)) },
          { name, statuses: ['HTTP/1.1 422'], errors: [], hadError: false },
        );
      });
    }
    await withServer(closing, async (base) => {
      const rest = DRAIN_LIMIT - 64 * 1024;
      deepStrictEqual(await refuseWhileSending(base, posting(DRAIN_LIMIT), rest), {
        statuses: ['HTTP/1.1 422'],
        errors: [],
        hadError: false,
      });
    });
  });

  it('stops reading a closed connection once the linger runs out', async () => {
    await withServer(handler(413), async (base) => {
      const { socket, seen } = await dial(base);
      const closed = new Promise<boolean>((resolve) => socket.once('close', resolve));
      socket.write(posting(64 * MB));
      await until(() => seen.ended);
      const ended = Date.now();
      const sending = setInterval(() => socket.write(new Uint8Array(16 * 1024)), 50);
      try {
        await closed;
      } finally {
        clearInterval(sending);
      }
      const lingered = Date.now() - ended;
      ok(lingered > 4000 && lingered < 6500, `lingered ${lingered}ms`);
    });
  });

  it('errors a body still read once its answer finished, rather than end it short', async () => {
    let read: Promise<ArrayBuffer> | undefined;
    const background: RequestListener = async (req, res) => {
      read = toRequest(req).arrayBuffer();
      read.catch(() => {});
      await sendResponse(res, new Response(null, { status: 202 }));
    };
    await withServer(background, async (base) => {
      const { socket, seen } = await dial(base);
      socket.write(posting(MB));
      socket.write(new Uint8Array(64 * 1024));
      try {
        await until(() => seen.text.includes('\r\n\r\n'));
        await rejects(read!, { name: 'AbortError' });
      } finally {
        socket.destroy();
      }
    });
  });

  it('errors the body when the client leaves before sending it whole', async () => {
    let read: Promise<string> | undefined;
    const reading: RequestListener = async (req, res) => {
      read = toRequest(req).text();
      await read.catch(() => {});
      res.destroy();
    };
    await withServer(reading, async (base) => {
      const { socket } = await dial(base);
      socket.write(posting(MB));
      socket.write(new Uint8Array(64 * 1024));
      await until(() => read !== undefined);
      socket.destroy();
      await rejects(read!);
    });
  });

  it('reads no further than the stream asks while its reader waits', async () => {
    let read = 0;
    const idle: RequestListener = async (req, res) => {
      await toRequest(req).body!.getReader().read();
      await delay(200);
      read = req.socket.bytesRead;
      await sendResponse(res, new Response(null, { status: 413 }));
    };
    await withServer(idle, async (base) => {
      const { socket, seen } = await dial(base);
      socket.write(posting(32 * MB));
      socket.write(new Uint8Array(32 * MB));
      try {
        await until(() => seen.ended, 5000);
      } finally {
        socket.destroy();
      }
    });
    ok(read > 0 && read < 8 * MB, `read ${read} bytes`);
  });
});
