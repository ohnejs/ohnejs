import { deepStrictEqual, ok, rejects } from 'node:assert';
import { describe, it } from 'node:test';

import { isOhneError } from '../../../src/ohne/error/ohne-error.ts';
import { useLayers } from '../../../src/ohne/layers/use-layers.ts';

const LAYER = '/collections-boot-test';

const BOOT = new URL('../../../src/uploads/boot/collections.ts', import.meta.url).href;

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

describe('the collections boot file', () => {
  it('stops the boot when `UploadsSessions` is disabled, pointing at the session route', async () => {
    deepStrictEqual(await refusal(['UploadsSessions']), {
      title: 'The uploads layer needs `UploadsSessions`',
      body: [
        'You list it in `disable.collections`, but the layer keeps its files and their bookkeeping there.',
        '',
        'Remove `UploadsSessions` from `disable.collections`.',
        'To send every file whole, list `POST /uploads/sessions` in `disable.routes` instead.',
      ],
    });
  });

  for (const name of ['Uploads', 'UploadsJournal']) {
    it(`stops the boot when \`${name}\` is disabled`, async () => {
      deepStrictEqual(await refusal([name]), {
        title: `The uploads layer needs \`${name}\``,
        body: [
          'You list it in `disable.collections`, but the layer keeps its files and their bookkeeping there.',
          '',
          `Remove \`${name}\` from \`disable.collections\`.`,
        ],
      });
    });
  }

  it('boots when the app disables other collections and the session route', async () => {
    useLayers().add({
      path: LAYER,
      input: { disable: { collections: ['Quests'], routes: ['POST /uploads/sessions'] } },
    });
    try {
      await import(`${BOOT}?others`);
    } finally {
      useLayers().remove(LAYER);
    }
  });
});
