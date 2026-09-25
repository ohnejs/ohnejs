import { deepStrictEqual, strictEqual } from 'node:assert';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, afterEach, before, describe, it } from 'node:test';

import type { FieldErrors } from '../../../src/ohne/index.ts';

import {
  defaultLanguage,
  resolveFieldErrors,
  translate,
} from '../../../src/ohne/http/translate.ts';
import {
  type Event,
  loadLayers,
  runWithEvent,
  useLayers,
  useMessages,
} from '../../../src/ohne/index.ts';

declare module 'ohnejs' {
  interface KnownMessages {
    'translateTest.maxLevel': { max: number };
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

describe('translate', () => {
  let root: string;

  before(() => {
    root = mkdtempSync(join(tmpdir(), 'ohne-translate-'));
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

  it('resolves the default language outside a request', async () => {
    await setup({
      en: { 'api.http.notFound': 'Not Found' },
      de: { 'api.http.notFound': 'Nicht gefunden' },
    });
    strictEqual(translate('api.http.notFound'), 'Not Found');
  });

  it('uses the negotiated language inside a request', async () => {
    await setup({
      en: { 'api.http.notFound': 'Not Found' },
      de: { 'api.http.notFound': 'Nicht gefunden' },
    });
    runWithEvent(makeEvent('de'), () => {
      strictEqual(translate('api.http.notFound'), 'Nicht gefunden');
    });
  });

  it('resolves the default inside a request with no `Accept-Language`, not catalog order', async () => {
    await setup({
      de: { 'api.http.notFound': 'Nicht gefunden' },
      en: { 'api.http.notFound': 'Not Found' },
    });
    runWithEvent(makeEvent(), () => {
      strictEqual(translate('api.http.notFound'), 'Not Found');
    });
  });

  it('formats a backticked parameter', async () => {
    await setup({ en: { 'api.messages.unknownGroup': 'Unknown message group `{group}`' } });
    strictEqual(
      translate('api.messages.unknownGroup', { group: 'x' }),
      'Unknown message group `x`',
    );
  });

  it('returns the key when it is absent from every language', async () => {
    await setup({ en: { 'api.http.notFound': 'Not Found' } });
    strictEqual(translate('does.not.exist'), 'does.not.exist');
  });
});

describe('resolveFieldErrors', () => {
  afterEach(() => {
    useMessages().clear();
  });

  it('resolves key and `{ key, params }` messages into a null-prototype map', () => {
    useMessages().register('en', {
      'translateTest.required': 'Required',
      'translateTest.maxLevel': 'At most `{max}`',
    });
    const resolved = resolveFieldErrors({
      name: 'translateTest.required',
      level: { key: 'translateTest.maxLevel', params: { max: 60 } },
    });

    strictEqual(Object.getPrototypeOf(resolved), null);
    deepStrictEqual({ ...resolved }, { name: 'Required', level: 'At most `60`' });
  });

  it('keeps a `__proto__` path', () => {
    const errors: FieldErrors = Object.create(null);
    errors['__proto__'] = 'Hearthstone is on cooldown';

    const resolved = resolveFieldErrors(errors);

    strictEqual(Object.hasOwn(resolved, '__proto__'), true);
    strictEqual(resolved['__proto__'], 'Hearthstone is on cooldown');
  });
});

describe('defaultLanguage', () => {
  afterEach(() => {
    for (const layer of useLayers().layers()) useLayers().remove(layer.path);
  });

  it('is `en` when the config sets none', () => {
    strictEqual(defaultLanguage(), 'en');
  });

  it('canonicalizes the configured tag', () => {
    useLayers().add({ path: '/app', input: { messages: { defaultLanguage: 'DE-at' } } });
    strictEqual(defaultLanguage(), 'de-AT');
  });
});
