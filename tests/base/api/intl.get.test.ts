import { deepStrictEqual, strictEqual, throws } from 'node:assert';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';

import handler from '../../../src/base/api/intl/[language].get.ts';
import { loadLayers, useLayers, useMessages } from '../../../src/ohne/index.ts';
import { deriveIntlData } from '../../../src/utils/i18n/intl-data.ts';

describe('GET /intl/:language', () => {
  let root: string;

  before(async () => {
    root = mkdtempSync(join(tmpdir(), 'ohne-intl-endpoint-'));
    const app = join(root, 'app');
    mkdirSync(app, { recursive: true });
    writeFileSync(join(app, 'package.json'), JSON.stringify({ name: 'app' }));
    writeFileSync(join(app, 'ohne.config.ts'), '');
    await loadLayers(app);
    useMessages().register('en', {
      'api.messages.invalidLanguage': 'Invalid language `{language}`',
      'api.intl.unknownLanguage': 'No date and number data for language `{language}`',
    });
  });

  after(() => {
    useMessages().clear();
    for (const layer of useLayers().layers()) useLayers().remove(layer.path);
    rmSync(root, { recursive: true, force: true });
  });

  it("answers the language's data, derived from the server's engine", () => {
    deepStrictEqual(handler({ params: { language: 'bs' } }), deriveIntlData('bs'));
  });

  it('derives once per language', () => {
    strictEqual(handler({ params: { language: 'de' } }), handler({ params: { language: 'de' } }));
  });

  it('responds 400 for a malformed language tag', () => {
    throws(() => handler({ params: { language: 'en_US' } }), {
      status: 400,
      message: 'Invalid language `en_US`',
    });
  });
});
