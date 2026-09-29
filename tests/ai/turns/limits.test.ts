import { doesNotReject, ok, rejects, strictEqual, throws } from 'node:assert';
import { describe, it } from 'node:test';
import { setTimeout as sleep } from 'node:timers/promises';

import type { User } from '../../../src/base/auth/types.ts';
import type { Event } from '../../../src/ohne/http/event.ts';

import {
  acquireStepPermit,
  assertTokenStore,
  chargeTokens,
  enforceTurnsLimit,
  probeTokens,
  stepSignal,
} from '../../../src/ai/turns/limits.ts';
import { isOhneError } from '../../../src/ohne/error/ohne-error.ts';
import { runWithEvent } from '../../../src/ohne/http/use-event.ts';
import { useLayers } from '../../../src/ohne/layers/use-layers.ts';
import { useRateLimitStores } from '../../../src/ohne/rate-limit/use-rate-limit-stores.ts';
import { userWith, withAI } from '../_fixture.ts';

const usage = { fresh: 90, cacheRead: 0, cacheWrite: 0, output: 60 };

/**
 * A bare request event, so the limits can read the request and set `Retry-After`.
 */
function makeEvent(): Event {
  return {
    request: new Request('http://x.test/ai/turns', { method: 'POST' }),
    url: new URL('http://x.test/ai/turns'),
    params: {},
    ip: '127.0.0.1',
    response: { status: 200, headers: new Headers() },
    context: {},
    appliedMiddleware: [],
    waitUntil() {},
  };
}

/**
 * A person with their own limiter key.
 */
function person(key: string): User {
  return { ...userWith('asker'), UUID: key };
}

describe('the token limit', () => {
  it('probes before a step, charges after it even past the cap, and refuses the next one', async () => {
    await withAI({ limits: { tokens: { limit: 100, window: '1h' } } }, async () => {
      const user = person('tokens-1');
      await doesNotReject(runWithEvent(makeEvent(), () => probeTokens(user)));
      await chargeTokens(user, usage);
      const event = makeEvent();
      await rejects(
        runWithEvent(event, () => probeTokens(user)),
        (error: unknown) => (error as { status: number }).status === 429,
      );
      ok(Number(event.response.headers.get('Retry-After')) > 0);
      await doesNotReject(chargeTokens(user, usage));
      await doesNotReject(runWithEvent(makeEvent(), () => probeTokens(person('tokens-2'))));
    });
  });

  it('is off with `false`', async () => {
    await withAI({ limits: { tokens: false } }, async () => {
      const user = person('tokens-3');
      for (let i = 0; i < 3; i++) await chargeTokens(user, usage);
      await doesNotReject(runWithEvent(makeEvent(), () => probeTokens(user)));
    });
  });
});

describe('the turns limit', () => {
  it('counts a turn per person and refuses past the cap', async () => {
    await withAI({ limits: { turns: { limit: 1, window: '1h' } } }, async () => {
      await doesNotReject(runWithEvent(makeEvent(), () => enforceTurnsLimit(person('turns-1'))));
      await rejects(
        runWithEvent(makeEvent(), () => enforceTurnsLimit(person('turns-1'))),
        (error: unknown) => (error as { status: number }).status === 429,
      );
      await doesNotReject(runWithEvent(makeEvent(), () => enforceTurnsLimit(person('turns-2'))));
    });
  });
});

describe('the step permits', () => {
  it('lets a person stream two steps at once, and refuses the third until one ends', () => {
    const user = person('permits-1');
    const first = acquireStepPermit(user);
    const second = acquireStepPermit(user);
    throws(
      () => acquireStepPermit(user),
      (error: unknown) => (error as { status: number }).status === 429,
    );
    first();
    const third = acquireStepPermit(user);
    second();
    third();
  });
});

describe('stepSignal', () => {
  it('aborts once `ai.limits.step` elapses', async () => {
    await withAI({ limits: { step: 10 } }, () =>
      runWithEvent(makeEvent(), async () => {
        const signal = stepSignal();
        strictEqual(signal.aborted, false);
        await sleep(40);
        strictEqual(signal.aborted, true);
      }),
    );
  });
});

describe('assertTokenStore', () => {
  it('passes on the shipped store, and refuses a store without `charge` unless tokens are off', async () => {
    await withAI(undefined, () => assertTokenStore());
    useRateLimitStores().register('ai-plain', () => ({
      take: () => Promise.resolve(0),
      reset: () => Promise.resolve(),
    }));
    // `api.rateLimitStore` is the app's own, so it rides the same layer as the `ai` settings.
    const store = { rateLimitStore: 'ai-plain' as never };
    try {
      useLayers().add({ path: '/ai-limits-test/store', input: { api: store } });
      throws(
        () => assertTokenStore(),
        (error: unknown) =>
          isOhneError(error) &&
          error.title === 'The rate-limit store `ai-plain` cannot count tokens',
      );
      useLayers().remove('/ai-limits-test/store');
      useLayers().add({
        path: '/ai-limits-test/store',
        input: { api: store, ai: { limits: { tokens: false } } },
      });
      assertTokenStore();
    } finally {
      useLayers().remove('/ai-limits-test/store');
      useRateLimitStores().delete('ai-plain');
    }
  });
});
