import { strictEqual } from 'node:assert';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, afterEach, before, describe, it } from 'node:test';

import { translate } from '../../../src/ohne/http/translate.ts';
import {
  type Event,
  loadLayers,
  runWithEvent,
  useLayers,
  useMessages,
} from '../../../src/ohne/index.ts';

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
