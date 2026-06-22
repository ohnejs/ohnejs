import { deepStrictEqual, strictEqual } from 'node:assert';
import { beforeEach, describe, it } from 'node:test';

import { applyHook, hook, useHooks } from '../../../src/ohne/index.ts';
import { sleep } from '../../../src/utils/index.ts';

declare module 'ohne' {
  interface Hooks {
    noop: (value: string) => string;
    upper: (s: string) => string;
    tap: (s: string) => string | void;
    ctx: (value: string, n: number) => string;
    async: (s: string) => Promise<string>;
    ping: (state: string) => void;
  }
}

describe('applyHook', () => {
  beforeEach(() => {
    useHooks().clear();
  });

  it('returns the value unchanged when no callbacks are registered', async () => {
    strictEqual(await applyHook('noop', 'value'), 'value');
  });

  it('threads the first argument through each callback', async () => {
    hook('upper', (s: string) => s.toUpperCase());
    hook('upper', (s: string) => `[${s}]`);
    strictEqual(await applyHook('upper', 'hi'), '[HI]');
  });

  it('leaves the value untouched when a callback returns undefined', async () => {
    const seen: string[] = [];
    hook('tap', (s: string) => {
      seen.push(s);
    });
    hook('tap', (s: string) => s + '!');
    hook('tap', (s: string) => {
      seen.push(s);
    });
    strictEqual(await applyHook('tap', 'x'), 'x!');
    deepStrictEqual(seen, ['x', 'x!']);
  });

  it('passes the trailing arguments to every callback unchanged', async () => {
    const contexts: number[] = [];
    hook('ctx', (value: string, n: number) => {
      contexts.push(n);
      return value + n;
    });
    hook('ctx', (value: string, n: number) => {
      contexts.push(n);
      return value + n;
    });
    strictEqual(await applyHook('ctx', 'a', 7), 'a77');
    deepStrictEqual(contexts, [7, 7]);
  });

  it('runs callbacks sequentially, awaiting each', async () => {
    const order: string[] = [];
    hook('async', async (s: string) => {
      await sleep(10);
      order.push('first');
      return s + '1';
    });
    hook('async', async (s: string) => {
      order.push('second');
      return s + '2';
    });
    strictEqual(await applyHook('async', ''), '12');
    deepStrictEqual(order, ['first', 'second']);
  });

  it('runs an action for effect and returns the first argument', async () => {
    let calls = 0;
    hook('ping', () => {
      calls++;
    });
    hook('ping', () => {
      calls++;
    });
    strictEqual(await applyHook('ping', 'state'), 'state');
    strictEqual(calls, 2);
  });
});
