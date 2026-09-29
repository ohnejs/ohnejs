import { deepStrictEqual, rejects } from 'node:assert';
import { afterEach, describe, it } from 'node:test';

import type { RouteRateLimit } from '../../../src/ohne/index.ts';

import { enforceLoginRateLimit } from '../../../src/base/auth/_login-rate-limit.ts';
import {
  type Event,
  HTTPError,
  runWithEvent,
  useRateLimitStores,
} from '../../../src/ohne/index.ts';
import { DEFAULTS } from '../../../src/ohne/layers/config.ts';
import { useLayers } from '../../../src/ohne/layers/use-layers.ts';

const LAYER = '/login-rate-limit-test';

useLayers().add({ path: '/login-rate-limit-defaults', defaults: DEFAULTS, input: {} });

function configure(loginRateLimit: RouteRateLimit | false): void {
  useLayers().add({ path: LAYER, input: { auth: { loginRateLimit } } });
}

async function attempt(ip: string): Promise<void> {
  const event: Event = {
    request: new Request('http://localhost/auth/login', { method: 'POST' }),
    url: new URL('http://localhost/auth/login'),
    params: {},
    ip,
    response: { status: 200, headers: new Headers() },
    context: {},
    appliedMiddleware: [],
    waitUntil() {},
  };
  await runWithEvent(event, enforceLoginRateLimit);
}

describe('enforceLoginRateLimit', () => {
  afterEach(() => {
    useLayers().remove(LAYER);
  });

  it('refuses a network past the configured `auth.loginRateLimit`', async () => {
    configure({ limit: 2, window: '1m' });
    await attempt('198.51.100.1');
    await attempt('198.51.100.1');
    await rejects(attempt('198.51.100.1'), HTTPError);
    await attempt('198.51.100.2');
  });

  it('never refuses when `auth.loginRateLimit` is `false`', async () => {
    configure(false);
    for (let i = 0; i < 20; i++) await attempt('198.51.100.3');
  });

  it('counts sign-ins in the app store under its own name', async () => {
    const taken: string[] = [];
    useRateLimitStores().register('recording', () => ({
      async take(key) {
        taken.push(key);
        return 0;
      },
      async reset() {},
    }));
    useLayers().add({ path: LAYER, input: { api: { rateLimitStore: 'recording' } } });
    await attempt('198.51.100.4');
    useRateLimitStores().delete('recording');
    deepStrictEqual(taken, ['["ohne:login","198.51.100.4"]']);
  });
});
