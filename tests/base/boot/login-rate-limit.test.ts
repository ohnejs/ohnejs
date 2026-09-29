import { deepStrictEqual, ok, rejects } from 'node:assert';
import { describe, it } from 'node:test';

import type { RouteRateLimit } from '../../../src/ohne/index.ts';

import { isOhneError } from '../../../src/ohne/error/ohne-error.ts';
import { DEFAULTS } from '../../../src/ohne/layers/config.ts';
import { useLayers } from '../../../src/ohne/layers/use-layers.ts';

const LAYER = '/base-login-rate-limit-boot-test';

const BOOT = new URL('../../../src/base/boot/login-rate-limit.ts', import.meta.url).href;

/**
 * Imports a fresh copy of the boot file under `auth.loginRateLimit`.
 */
async function load(loginRateLimit: RouteRateLimit | false): Promise<void> {
  useLayers().add({ path: LAYER, defaults: DEFAULTS, input: { auth: { loginRateLimit } } });
  try {
    await import(`${BOOT}?${JSON.stringify(loginRateLimit)}`);
  } finally {
    useLayers().remove(LAYER);
  }
}

describe('base boot: login rate limit', () => {
  it('refuses an invalid `auth.loginRateLimit` with a block', async () => {
    await rejects(load({ limit: 0, window: '1m' }), (error: unknown) => {
      ok(isOhneError(error), String(error));
      deepStrictEqual(
        [error.title, error.body],
        [
          'Invalid `auth.loginRateLimit`',
          ['Invalid limit: 0', '', 'Set a positive whole `limit` and `window`, or `false`.'],
        ],
      );
      return true;
    });
  });

  it('loads for a valid limit and for `false`', async () => {
    await load({ limit: 5, window: '1m' });
    await load(false);
  });
});
