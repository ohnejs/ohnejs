import type { AddressInfo } from 'node:net';

import { strictEqual } from 'node:assert';
import { once } from 'node:events';
import { createServer, request, type RequestListener } from 'node:http';
import { describe, it } from 'node:test';

import { sendResponse, toRequest } from '../../../src/ohne/index.ts';

async function withServer(
  handler: RequestListener,
  run: (base: string) => Promise<void>,
): Promise<void> {
  const server = createServer(handler);
  server.listen(0);
  await once(server, 'listening');
  const { port } = server.address() as AddressInfo;
  try {
    await run(`http://localhost:${port}`);
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
});
