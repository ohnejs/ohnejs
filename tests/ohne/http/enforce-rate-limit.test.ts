import { ok, rejects, strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import {
  enforceRateLimit,
  type Event,
  HTTPError,
  runWithEvent,
  useResponse,
} from '../../../src/ohne/index.ts';
import { createMemoryRateLimitStore, createRateLimiter } from '../../../src/utils/index.ts';

function makeEvent(ip: string): Event {
  return {
    request: new Request('http://localhost/'),
    url: new URL('http://localhost/'),
    params: {},
    ip,
    response: { status: 200, headers: new Headers() },
    context: {},
    appliedMiddleware: [],
    waitUntil() {},
  };
}

describe('enforceRateLimit', () => {
  it('answers 429 with Retry-After in whole seconds, rounded up', async () => {
    const clock = { now: 0 };
    const store = createMemoryRateLimitStore({ now: () => clock.now });
    const limiter = createRateLimiter({ limit: 1, window: 1002, store });
    await runWithEvent(makeEvent('10.0.0.1'), async () => {
      await enforceRateLimit(limiter);
      clock.now = 1001;
      await rejects(enforceRateLimit(limiter), (error) => {
        ok(error instanceof HTTPError);
        return error.status === 429;
      });
      strictEqual(useResponse().headers.get('retry-after'), '1');
    });
    await runWithEvent(makeEvent('10.0.0.2'), async () => {
      await enforceRateLimit(limiter);
      await rejects(enforceRateLimit(limiter), HTTPError);
      strictEqual(useResponse().headers.get('retry-after'), '2');
    });
  });

  it('counts one IPv6 /64 as one client', async () => {
    const limiter = createRateLimiter({ limit: 1, window: 1000 });
    await runWithEvent(makeEvent('2001:db8:1:2::1'), () => enforceRateLimit(limiter));
    await runWithEvent(makeEvent('2001:db8:1:2::2'), () =>
      rejects(enforceRateLimit(limiter), HTTPError),
    );
    await runWithEvent(makeEvent('2001:db8:1:3::1'), () => enforceRateLimit(limiter));
  });

  it('counts under an explicit key', async () => {
    const limiter = createRateLimiter({ limit: 1, window: 1000 });
    await runWithEvent(makeEvent('10.0.0.1'), () => enforceRateLimit(limiter, 'thrall'));
    await runWithEvent(makeEvent('10.0.0.2'), () =>
      rejects(enforceRateLimit(limiter, 'thrall'), HTTPError),
    );
  });

  it('never limits a request without a known IP', async () => {
    const limiter = createRateLimiter({ limit: 1, window: 1000 });
    await runWithEvent(makeEvent(''), async () => {
      for (let i = 0; i < 3; i++) await enforceRateLimit(limiter);
    });
  });
});
