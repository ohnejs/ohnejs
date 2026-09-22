import { deepStrictEqual, strictEqual } from 'node:assert';
import { afterEach, describe, it } from 'node:test';

import { useEnv } from '../../src/ohne/env/use-env.ts';
import { useLayers } from '../../src/ohne/layers/use-layers.ts';
import { UPLOADS_DEFAULTS, useUploadsConfig } from '../../src/uploads/config.ts';

const PATH = '/uploads-config-test';

describe('useUploadsConfig', () => {
  afterEach(() => {
    useLayers().remove(PATH);
  });

  it('falls back to the layer defaults', () => {
    deepStrictEqual(useUploadsConfig(), UPLOADS_DEFAULTS);
  });

  it('unions variants by name and replaces a redefined preset whole', () => {
    useLayers().add({
      path: PATH,
      input: {
        uploads: { images: { variants: { thumbnail: { width: 200 }, hero: { width: 1200 } } } },
      },
    });
    deepStrictEqual(useUploadsConfig().images, {
      variants: { thumbnail: { width: 200 }, hero: { width: 1200 } },
    });
  });

  it('replaces cache rather than merging it', () => {
    useLayers().add({ path: PATH, input: { uploads: { cache: { maxAge: 60 } } } });
    deepStrictEqual(useUploadsConfig().cache, { maxAge: 60 });
  });
});

describe('the uploads env vars', () => {
  it('declare no CLI flag, since the CLI parses its flags before any layer loads', () => {
    strictEqual(useEnv().flag('UPLOADS_URL'), undefined);
    strictEqual(useEnv().flag('IMAGES_SECRET'), undefined);
    strictEqual(useEnv().flag('UPLOADS_SECRET'), undefined);
  });
});
