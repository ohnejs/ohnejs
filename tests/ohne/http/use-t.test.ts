import { strictEqual } from 'node:assert';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, afterEach, before, describe, it } from 'node:test';

import {
  type Event,
  loadLayers,
  runWithEvent,
  useLayers,
  useMessages,
  useT,
} from '../../../src/ohne/index.ts';

declare module 'ohne' {
  interface KnownMessages {
    greeting: { name: string | number };
    plain: {};
    unit: {};
    items: { n: number };
    'missing.key': {};
  }
}

function makeEvent(acceptLanguage?: string, locale?: string): Event {
  const headers = new Headers();
  if (acceptLanguage !== undefined) headers.set('accept-language', acceptLanguage);
  return {
    request: new Request('http://localhost/', { headers }),
    url: new URL('http://localhost/'),
    params: {},
    ip: '',
    response: { status: 200, headers: new Headers() },
    context: locale === undefined ? {} : { locale },
    appliedMiddleware: [],
    waitUntil() {},
  };
}

describe('useT', () => {
  let root: string;

  before(() => {
    root = mkdtempSync(join(tmpdir(), 'ohne-use-t-'));
    const app = join(root, 'app');
    mkdirSync(app, { recursive: true });
    writeFileSync(join(app, 'package.json'), JSON.stringify({ name: 'app' }));
    writeFileSync(join(app, 'ohne.config.ts'), '');
  });

  after(() => {
    rmSync(root, { recursive: true, force: true });
  });

  afterEach(() => {
    useMessages().clear();
    for (const layer of useLayers().layers()) useLayers().remove(layer.path);
  });

  async function setup(catalogs: Record<string, Record<string, string>>): Promise<void> {
    await loadLayers(join(root, 'app'));
    for (const [language, catalog] of Object.entries(catalogs)) {
      useMessages().register(language, catalog);
    }
  }

  it('formats a message in the negotiated language', async () => {
    await setup({ en: { greeting: 'Hi {name}' }, de: { greeting: 'Hallo {name}' } });
    runWithEvent(makeEvent('de'), () => {
      strictEqual(useT()('greeting', { name: 'Mo' }), 'Hallo Mo');
    });
  });

  it('falls back to the default language for a missing key', async () => {
    await setup({ en: { plain: 'Welcome' }, de: { greeting: 'Hallo {name}' } });
    runWithEvent(makeEvent('de'), () => {
      strictEqual(useT()('plain'), 'Welcome');
    });
  });

  it('falls back up the language chain before the default', async () => {
    await setup({
      en: { unit: 'meter' },
      de: { unit: 'Meter' },
      'de-AT': { greeting: 'Servus {name}' },
    });
    runWithEvent(makeEvent('de-AT'), () => {
      strictEqual(useT()('unit'), 'Meter');
    });
  });

  it('returns the key when it is absent from every language', async () => {
    await setup({ en: { greeting: 'Hi {name}' } });
    runWithEvent(makeEvent('en'), () => {
      strictEqual(useT()('missing.key'), 'missing.key');
    });
  });

  it('prefers context.locale over Accept-Language', async () => {
    await setup({ en: { greeting: 'Hi {name}' }, de: { greeting: 'Hallo {name}' } });
    runWithEvent(makeEvent('en', 'de'), () => {
      strictEqual(useT()('greeting', { name: 'Mo' }), 'Hallo Mo');
    });
  });

  it('formats a fallback message with its origin plural rules, not the active language', async () => {
    await setup({
      ru: { plain: 'Privet' },
      en: { items: '{n, plural, one {# item} other {# items}}' },
    });
    runWithEvent(makeEvent('ru'), () => {
      // `items` exists only in `en`, so English plural rules apply: 21 -> `other`.
      // Russian rules would pick `one` for 21, which would be wrong for the English text.
      strictEqual(useT()('items', { n: 21 }), '21 items');
    });
  });
});

/**
 * Compile-time assertions for the strict `t` surface, checked by `tsc` and never executed.
 */
export function assertMessageTypes(): void {
  const t = useT();
  t('greeting', { name: 'Mo' });
  t('plain');
  // @ts-expect-error - unknown key
  t('unknown.key');
  // @ts-expect-error - missing required parameters
  t('greeting');
  // @ts-expect-error - parameter `name` is required
  t('greeting', {});
  // @ts-expect-error - no parameters allowed for this key
  t('plain', { foo: 'x' });
  // @ts-expect-error - parameter `n` must be a number
  t('items', { n: 'x' });
}
