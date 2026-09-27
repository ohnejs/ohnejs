import { deepStrictEqual, strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import type { Route } from '../../../src/ohne/routes/route.ts';

import { readSessionToken } from '../../../src/base/auth/_cookie.ts';
import en from '../../../src/base/messages/auth/en.json' with { type: 'json' };
import corsGlobal from '../../../src/base/middleware/global/cors.ts';
import { cors } from '../../../src/ohne/http/cors.ts';
import { dispatch } from '../../../src/ohne/http/dispatch.ts';
import { useLayers } from '../../../src/ohne/layers/use-layers.ts';
import { useMessages } from '../../../src/ohne/messages/use-messages.ts';
import { useMiddleware } from '../../../src/ohne/middleware/use-middleware.ts';
import { usePrinter } from '../../../src/ohne/printer/use-printer.ts';
import { defineHandler } from '../../../src/ohne/routes/define-handler.ts';

usePrinter().configure({ stream: { write: () => true } });

useLayers().add({ path: '/origin-test', input: { dashboard: { port: 9320 } } });
useMessages().register('en', { 'auth.untrustedOrigin': en.untrustedOrigin });
useMiddleware().registerGlobal('cors', corsGlobal);

const DASHBOARD = 'http://localhost:9320';
const SIBLING = 'http://localhost:3000';

useMiddleware().register('open-cors', cors({ origin: SIBLING }));
const token = 'token-origin';

function route(method: 'GET' | 'POST', middleware: 'open-cors'[] = []): Route {
  return {
    method,
    pattern: '/who',
    file: 'who.ts',
    layer: 'ohnejs/base',
    handler: defineHandler(() => ({ token: readSessionToken() }), {
      middleware,
    }) as Route['handler'],
  };
}

interface CallInit {
  cookie?: boolean;
  bearer?: boolean;
  origin?: string;
  fetchSite?: string;
}

async function call(r: Route, init: CallInit): Promise<Response> {
  const headers = new Headers();
  if (init.cookie) headers.set('cookie', `session=${token}`);
  if (init.bearer) headers.set('authorization', `Bearer ${token}`);
  if (init.origin !== undefined) headers.set('origin', init.origin);
  if (init.fetchSite !== undefined) headers.set('sec-fetch-site', init.fetchSite);
  const url = 'http://localhost:9001/who';
  const { response } = await dispatch(
    r,
    new Request(url, { method: r.method ?? 'GET', headers }),
    new URL(url),
    {},
  );
  return response;
}

describe('assertCookieOrigin', () => {
  it('refuses a cookie write from a same-site page the cors policy has not credentialed', async () => {
    const response = await call(route('POST'), {
      cookie: true,
      origin: SIBLING,
      fetchSite: 'same-site',
    });
    strictEqual(response.status, 403);
    strictEqual(
      ((await response.json()) as { message: string }).message,
      `Session cookies are not accepted from \`${SIBLING}\``,
    );
  });

  it('passes a cookie write from the dashboard origin the base cors credentials', async () => {
    const response = await call(route('POST'), {
      cookie: true,
      origin: DASHBOARD,
      fetchSite: 'same-site',
    });
    strictEqual(response.status, 200);
    deepStrictEqual(await response.json(), { token });
  });

  it('passes a Bearer token from a hostile origin', async () => {
    const response = await call(route('POST'), {
      bearer: true,
      origin: SIBLING,
      fetchSite: 'same-site',
    });
    deepStrictEqual(await response.json(), { token });
  });

  it('passes a cookie write without fetch metadata or Origin', async () => {
    deepStrictEqual(await (await call(route('POST'), { cookie: true })).json(), { token });
  });

  it('passes a cookie read from a hostile origin', async () => {
    const response = await call(route('GET'), {
      cookie: true,
      origin: SIBLING,
      fetchSite: 'same-site',
    });
    deepStrictEqual(await response.json(), { token });
  });

  it('refuses a cookie write from an origin allowed without credentials', async () => {
    const response = await call(route('POST', ['open-cors']), {
      cookie: true,
      origin: SIBLING,
      fetchSite: 'same-site',
    });
    strictEqual(response.headers.get('access-control-allow-origin'), SIBLING);
    strictEqual(response.status, 403);
  });
});
