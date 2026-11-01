import { deepStrictEqual } from 'node:assert';
import { afterEach, describe, it } from 'node:test';

import { useConfig } from '../../../src/ohne/layers/use-config.ts';
import { useLayers } from '../../../src/ohne/layers/use-layers.ts';

const LAYER = '/use-config-test';

afterEach(() => {
  useLayers().remove(LAYER);
});

describe('useConfig', () => {
  it('hands out the content locales canonicalized', () => {
    useLayers().add({
      path: LAYER,
      input: { collections: { locales: ['EN', 'de-at'], defaultLocale: 'en' } },
    });
    deepStrictEqual(useConfig().collections, { locales: ['en', 'de-AT'], defaultLocale: 'en' });
  });

  it('keeps an invalid tag as written, so locale resolution reports it', () => {
    useLayers().add({ path: LAYER, input: { collections: { locales: ['en', 'en_US'] } } });
    deepStrictEqual(useConfig().collections?.locales, ['en', 'en_US']);
  });
});
