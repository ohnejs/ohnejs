import { strictEqual } from 'node:assert';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, afterEach, before, describe, it } from 'node:test';

import { createMessagesTarget } from '../../../../src/ohne/dev/targets/messages.ts';
import { loadLayers, useLayers } from '../../../../src/ohne/index.ts';

describe('messages target', () => {
  let root: string;

  function writeApp(name: string): string {
    const app = join(root, name);
    mkdirSync(app, { recursive: true });
    writeFileSync(join(app, 'package.json'), JSON.stringify({ name, type: 'module' }));
    writeFileSync(join(app, 'ohne.config.ts'), '');
    return app;
  }

  function writeMessages(app: string, relative: string, data: unknown): void {
    const file = join(app, 'messages', relative);
    mkdirSync(join(file, '..'), { recursive: true });
    writeFileSync(file, JSON.stringify(data));
  }

  before(() => {
    root = realpathSync(mkdtempSync(join(tmpdir(), 'ohne-messages-target-')));
  });

  after(() => {
    rmSync(root, { recursive: true, force: true });
  });

  afterEach(() => {
    useLayers().clear();
  });

  it('gates on its own dir and writes the table', async () => {
    const app = writeApp('regen');
    writeMessages(app, 'en.json', { greeting: 'Hi' });
    await loadLayers(app);
    const target = createMessagesTarget(app);
    const out = join(app, '.ohne', 'messages.ts');

    strictEqual(target.affectedBy(join(app, 'messages', 'en.json')), true);
    strictEqual(target.affectedBy(join(app, 'api', 'health.ts')), false);

    await target.regen();
    strictEqual(readFileSync(out, 'utf8').includes("greeting: 'Hi'"), true);
  });

  it('regenerates on a content change, not just a file-set change', async () => {
    const app = writeApp('content');
    writeMessages(app, 'en.json', { greeting: 'Hi' });
    await loadLayers(app);
    const target = createMessagesTarget(app);
    const out = join(app, '.ohne', 'messages.ts');

    await target.regen();
    strictEqual(readFileSync(out, 'utf8').includes("greeting: 'Hi'"), true);

    writeMessages(app, 'en.json', { greeting: 'Hello' });
    await target.regen();
    const updated = readFileSync(out, 'utf8');
    strictEqual(updated.includes("greeting: 'Hello'"), true);
    strictEqual(updated.includes("greeting: 'Hi'"), false);
  });
});
