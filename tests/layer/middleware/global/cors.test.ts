import { deepStrictEqual, strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import type { AnyHandler, Route } from '../../../../src/ohne/routes/route.ts';

import corsGlobal from '../../../../src/layer/middleware/global/cors.ts';
import { dispatch } from '../../../../src/ohne/http/dispatch.ts';
import { useLayers } from '../../../../src/ohne/layers/use-layers.ts';
import { useMiddleware } from '../../../../src/ohne/middleware/use-middleware.ts';
import { usePrinter } from '../../../../src/ohne/printer/use-printer.ts';
import { defineHandler } from '../../../../src/ohne/routes/define-handler.ts';

usePrinter().configure({ stream: { write: () => true } });

useLayers().add({ path: '/cors-test', input: { dashboard: { port: 9310 } } });
useMiddleware().registerGlobal('cors', corsGlobal);

const DASHBOARD = 'http://localhost:9310';

const route: Route = {
  method: 'GET',
  pattern: '/ping',
  file: 'ping.get.ts',
  layer: 'ohnejs',
  handler: defineHandler(() => ({ ok: true })) as AnyHandler,
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
});
