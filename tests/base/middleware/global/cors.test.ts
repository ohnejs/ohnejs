import { deepStrictEqual, strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import type { AnyHandler, Route } from '../../../../src/ohne/routes/route.ts';

import { readSessionToken } from '../../../../src/base/auth/_cookie.ts';
import corsGlobal from '../../../../src/base/middleware/global/cors.ts';
import { cors, type CORSOptions } from '../../../../src/ohne/http/cors.ts';
import { dispatch } from '../../../../src/ohne/http/dispatch.ts';
import { useLayers } from '../../../../src/ohne/layers/use-layers.ts';
import { useMiddleware } from '../../../../src/ohne/middleware/use-middleware.ts';
import { usePrinter } from '../../../../src/ohne/printer/use-printer.ts';
import { defineHandler } from '../../../../src/ohne/routes/define-handler.ts';

usePrinter().configure({ stream: { write: () => true } });

useLayers().add({ path: '/cors-test', input: { dashboard: { port: 9310 } } });
useMiddleware().registerGlobal('cors', corsGlobal);

const DASHBOARD = 'http://localhost:9310';
const APP = 'http://localhost:3000';

const route: Route = {
  method: 'GET',
  pattern: '/ping',
  file: 'ping.get.ts',
  layer: 'ohnejs/base',
  handler: defineHandler(() => ({ ok: true })) as AnyHandler,
};

const write: Route = {
  method: 'POST',
  pattern: '/write',
  file: 'write.post.ts',
  layer: 'ohnejs/base',
  handler: defineHandler(() => ({ token: readSessionToken() })) as AnyHandler,
};

async function call(origin: string | null): Promise<Response> {
  const url = 'http://x.test/ping';
  const headers = new Headers();
  if (origin !== null) headers.set('Origin', origin);
  const { response } = await dispatch(route, new Request(url, { headers }), new URL(url), {});
  return response;
}

describe('cors global', () => {
  it('allows the dashboard origin with credentials', async () => {
    const response = await call(DASHBOARD);
    strictEqual(response.status, 200);
    strictEqual(response.headers.get('access-control-allow-origin'), DASHBOARD);
    strictEqual(response.headers.get('access-control-allow-credentials'), 'true');
    strictEqual(response.headers.get('vary'), 'Origin');
    deepStrictEqual(await response.json(), { ok: true });
  });

  it('lets the dashboard read `Retry-After`, so a throttled login waits it out', async () => {
    const response = await call(DASHBOARD);
    strictEqual(response.headers.get('access-control-expose-headers'), 'Retry-After');
  });

  it('gives a foreign origin no CORS headers', async () => {
    const response = await call('http://evil.example');
    strictEqual(response.headers.get('access-control-allow-origin'), null);
    strictEqual(response.headers.get('access-control-allow-credentials'), null);
    strictEqual(response.headers.get('vary'), 'Origin');
  });

  it('leaves a same-origin request untouched', async () => {
    const response = await call(null);
    strictEqual(response.headers.get('access-control-allow-origin'), null);
  });

  it('trusts the cookie on a write only from the origins a shadowing policy credentials', async () => {
    const status = async (options: CORSOptions): Promise<number> => {
      useMiddleware().registerGlobal('cors', cors(options));
      try {
        const url = 'http://localhost:9001/write';
        const headers = { origin: APP, 'sec-fetch-site': 'same-site', cookie: 'session=t' };
        const request = new Request(url, { method: 'POST', headers });
        return (await dispatch(write, request, new URL(url), {})).response.status;
      } finally {
        useMiddleware().registerGlobal('cors', corsGlobal);
      }
    };
    strictEqual(await status({ origin: [DASHBOARD, APP], credentials: true }), 200);
    strictEqual(await status({ origin: [DASHBOARD, APP] }), 403);
  });
});
