import { rejects } from 'node:assert';
import { describe, it } from 'node:test';

import { isOhneError } from '../../../src/ohne/error/ohne-error.ts';
import { useLayers } from '../../../src/ohne/layers/use-layers.ts';
import '../_fixture.ts';

const LAYER = '/config-boot-test';

const BOOT = new URL('../../../src/uploads/boot/config.ts', import.meta.url).href;

describe('the config boot file', () => {
  it('stops the boot on a bad uploads setting, before any request', async () => {
    useLayers().add({ path: LAYER, input: { uploads: { fetch: { allow: ['stormwind'] } } } });
    try {
      await rejects(
        import(`${BOOT}?bad`),
        (error: unknown) =>
          isOhneError(error) && error.title === 'Invalid `uploads.fetch.allow` entry `stormwind`',
      );
    } finally {
      useLayers().remove(LAYER);
    }
  });

  it('boots with good settings', async () => {
    await import(`${BOOT}?good`);
  });
});
