import { deepStrictEqual } from 'node:assert';
import { afterEach, describe, it } from 'node:test';
import { useConfig, useLayers } from 'ohne';

describe('collections config merge', () => {
  const added = ['/locales-base', '/locales-app'];

  afterEach(() => {
    for (const path of added) useLayers().remove(path);
  });

  it('inherits the content dimension, the closer layer winning per key', () => {
    const layers = useLayers();
    layers.add({
      path: '/locales-base',
      defaults: { collections: { locales: ['en', 'de'], defaultLocale: 'de' } },
    });
    layers.add({
      path: '/locales-app',
      input: { collections: { defaultLocale: 'en' } },
    });
    deepStrictEqual(useConfig().collections, { locales: ['en', 'de'], defaultLocale: 'en' });
  });

  it('replaces the locale set wholesale, never concatenating', () => {
    const layers = useLayers();
    layers.add({
      path: '/locales-base',
      defaults: { collections: { locales: ['en', 'de'] } },
    });
    layers.add({
      path: '/locales-app',
      input: { collections: { locales: ['fr'], defaultLocale: 'fr' } },
    });
    deepStrictEqual(useConfig().collections, { locales: ['fr'], defaultLocale: 'fr' });
  });
});
