import { deepStrictEqual, throws } from 'node:assert';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, afterEach, before, describe, it } from 'node:test';

import handler from '../../../src/base/api/messages/[group]/[language].get.ts';
import { loadLayers, useLayers, useMessages } from '../../../src/ohne/index.ts';

describe('GET /messages/:group/:language', () => {
  let root: string;

  before(() => {
    root = mkdtempSync(join(tmpdir(), 'ohne-messages-endpoint-'));
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

  it('returns only the requested group, keyed in full', async () => {
    await setup({
      en: {
        'field.required': 'Required',
        'field.minLength': 'Too short',
        'dashboard.save': 'Save',
      },
    });
    deepStrictEqual(handler({ params: { group: 'field', language: 'en' } }), {
      'field.required': { template: 'Required', language: 'en' },
      'field.minLength': { template: 'Too short', language: 'en' },
    });
  });

  it('fills a missing key from the upper language, tagged with its origin', async () => {
    await setup({
      en: { 'field.required': 'Required', 'field.minLength': 'Too short' },
      de: { 'field.required': 'Pflichtfeld' },
    });
    deepStrictEqual(handler({ params: { group: 'field', language: 'de' } }), {
      'field.required': { template: 'Pflichtfeld', language: 'de' },
      'field.minLength': { template: 'Too short', language: 'en' },
    });
  });

  it('walks the language chain, most specific winning', async () => {
    await setup({
      en: { 'field.required': 'Required' },
      de: { 'field.required': 'Pflichtfeld' },
      'de-AT': { 'field.required': 'Pflichtfeld (AT)' },
    });
    deepStrictEqual(handler({ params: { group: 'field', language: 'de-AT' } }), {
      'field.required': { template: 'Pflichtfeld (AT)', language: 'de-AT' },
    });
  });

  it('responds 404 for a group with no keys', async () => {
    await setup({
      en: {
        'field.required': 'Required',
        'api.messages.unknownGroup': 'Unknown message group `{group}`',
      },
    });
    throws(
      () => handler({ params: { group: 'dashboard', language: 'en' } }),
      /Unknown message group `dashboard`/,
    );
  });

  it('responds 400 for a malformed language tag', async () => {
    await setup({
      en: {
        'field.required': 'Required',
        'api.messages.invalidLanguage': 'Invalid language `{language}`',
      },
    });
    throws(
      () => handler({ params: { group: 'field', language: 'en_US' } }),
      /Invalid language `en_US`/,
    );
  });
});
