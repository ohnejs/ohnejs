import { deepStrictEqual, ok, rejects } from 'node:assert';
import { randomUUID } from 'node:crypto';
import { describe, it } from 'node:test';

import { useEnv } from '../../../src/ohne/env/use-env.ts';
import { isOhneError } from '../../../src/ohne/error/ohne-error.ts';
import { DEFAULTS } from '../../../src/ohne/layers/config.ts';
import { useLayers } from '../../../src/ohne/layers/use-layers.ts';

const LAYER = '/base-passkeys-boot-test';

const BOOT = new URL('../../../src/base/boot/passkeys.ts', import.meta.url).href;

/**
 * Imports a fresh copy of the boot file under `input`.
 */
async function load(input: Record<string, unknown>): Promise<void> {
  useLayers().add({ path: LAYER, defaults: DEFAULTS, input });
  try {
    await import(`${BOOT}?${randomUUID()}`);
  } finally {
    useLayers().remove(LAYER);
  }
}

/**
 * Asserts `input` stops the boot with the block `title`.
 */
async function refuses(input: Record<string, unknown>, title: string): Promise<void> {
  await rejects(load(input), (error: unknown) => {
    ok(isOhneError(error), String(error));
    deepStrictEqual(error.title, title);
    return true;
  });
}

describe('base boot: passkeys', () => {
  it('refuses password sign-in off without passkeys', async () => {
    await refuses({ auth: { password: false } }, 'No way to sign in');
  });

  it('refuses passkeys without `COOKIE_SECRET`', async () => {
    useEnv().set('COOKIE_SECRET', undefined);
    await refuses({ auth: { passkeys: true } }, 'Passkeys need `COOKIE_SECRET`');
  });

  it('refuses passkeys with `Passkeys` disabled', async () => {
    useEnv().set('COOKIE_SECRET', 'k');
    await refuses(
      { auth: { passkeys: true }, disable: { collections: ['Passkeys'] } },
      'Passkeys need the `Passkeys` collection',
    );
  });

  it('loads with passkeys off, and with passkeys and a secret', async () => {
    await load({});
    await load({ disable: { collections: ['Passkeys'] } });
    useEnv().set('COOKIE_SECRET', 'k');
    await load({ auth: { passkeys: true, password: false } });
  });
});
