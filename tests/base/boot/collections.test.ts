import { deepStrictEqual, ok, rejects } from 'node:assert';
import { describe, it } from 'node:test';

import { isOhneError } from '../../../src/ohne/error/ohne-error.ts';
import { useLayers } from '../../../src/ohne/layers/use-layers.ts';

const LAYER = '/base-collections-boot-test';

const BOOT = new URL('../../../src/base/boot/collections.ts', import.meta.url).href;

/**
 * Imports a fresh copy of the boot file with `collections` disabled, resolving the block it throws.
 */
async function refusal(collections: string[]): Promise<{ title?: string; body?: unknown }> {
  useLayers().add({ path: LAYER, input: { disable: { collections } } });
  try {
    let thrown: unknown;
    await rejects(import(`${BOOT}?${collections.join(',')}`), (error: unknown) => {
      thrown = error;
      return true;
    });
    ok(isOhneError(thrown), String(thrown));
    return { title: thrown.title, body: thrown.body };
  } finally {
    useLayers().remove(LAYER);
  }
}

/**
 * The block the boot file throws for a disabled `name`.
 */
function block(name: string): { title: string; body: string[] } {
  return {
    title: `The \`ohnejs/base\` layer needs \`${name}\``,
    body: [
      'You list it in `disable.collections`, but sign-in keeps its users and sessions there.',
      '',
      `Remove \`${name}\` from \`disable.collections\`.`,
    ],
  };
}

describe('the collections boot file', () => {
  for (const name of ['Users', 'Sessions']) {
    it(`stops the boot when \`${name}\` is disabled`, async () => {
      deepStrictEqual(await refusal([name]), block(name));
    });
  }

  it('stops the boot when the app drops the whole sign-in, naming `Users`', async () => {
    deepStrictEqual(await refusal(['Sessions', 'Users']), block('Users'));
  });

  it('boots when the app disables other collections and the auth routes', async () => {
    useLayers().add({
      path: LAYER,
      input: { disable: { collections: ['Quests'], routes: ['/auth/**'] } },
    });
    try {
      await import(`${BOOT}?others`);
    } finally {
      useLayers().remove(LAYER);
    }
  });
});
