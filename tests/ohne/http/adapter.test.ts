import type { AddressInfo } from 'node:net';

import { deepStrictEqual, ok, rejects, strictEqual } from 'node:assert';
import { once } from 'node:events';
import { createServer, request, type RequestListener } from 'node:http';
import { text } from 'node:stream/consumers';
import { describe, it } from 'node:test';
import { setImmediate } from 'node:timers/promises';

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
