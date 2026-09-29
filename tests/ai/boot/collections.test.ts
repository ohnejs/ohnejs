import { deepStrictEqual, ok, rejects } from 'node:assert';
import { describe, it } from 'node:test';

import { isOhneError } from '../../../src/ohne/error/ohne-error.ts';
import { useLayers } from '../../../src/ohne/layers/use-layers.ts';

const LAYER = '/ai-collections-boot-test';

const BOOT = new URL('../../../src/ai/boot/collections.ts', import.meta.url).href;

describe('the collections boot file', () => {
  it('stops the boot when `AITurns` is disabled', async () => {
    useLayers().add({ path: LAYER, input: { disable: { collections: ['AITurns'] } } });
    try {
      let thrown: unknown;
      await rejects(import(`${BOOT}?disabled`), (error: unknown) => {
        thrown = error;
        return true;
      });
      ok(isOhneError(thrown), String(thrown));
      deepStrictEqual(
        { title: thrown.title, body: thrown.body },
        {
          title: 'The assistant layer needs `AITurns`',
          body: [
            'You list it in `disable.collections`, but the layer keeps every turn there between steps.',
            '',
            'Remove `AITurns` from `disable.collections`.',
          ],
        },
      );
    } finally {
      useLayers().remove(LAYER);
    }
  });

  it('boots when the app disables other collections', async () => {
    useLayers().add({ path: LAYER, input: { disable: { collections: ['Quests'] } } });
    try {
      await import(`${BOOT}?others`);
    } finally {
      useLayers().remove(LAYER);
    }
  });
});
