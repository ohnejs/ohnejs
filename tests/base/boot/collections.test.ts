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
 * The block the boot file throws for a disabled sign-in collection `name`.
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

/**
 * The block the boot file throws for a disabled bookmarks collection `name`.
 */
function bookmarksBlock(name: string): { title: string; body: string[] } {
  return {
    title: `The \`ohnejs/base\` layer needs \`${name}\``,
    body: [
      'You list it in `disable.collections`, but the dashboard keeps its table bookmarks there.',
      '',
      `Remove \`${name}\` from \`disable.collections\`.`,
      'To turn bookmarks off, list `/dashboard/bookmarks/**` in `disable.routes` instead.',
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

  for (const name of ['DashboardBookmarks', 'DashboardBookmarkDefaults']) {
    it(`stops the boot when \`${name}\` is disabled, pointing at the bookmark routes`, async () => {
      deepStrictEqual(await refusal([name]), bookmarksBlock(name));
    });
  }

  it('boots when the app disables other collections, the auth routes, and the bookmark routes', async () => {
    useLayers().add({
      path: LAYER,
      input: {
        disable: { collections: ['Quests'], routes: ['/auth/**', '/dashboard/bookmarks/**'] },
      },
    });
    try {
      await import(`${BOOT}?others`);
    } finally {
      useLayers().remove(LAYER);
    }
  });
});
