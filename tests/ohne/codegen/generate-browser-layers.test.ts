import { strictEqual } from 'node:assert';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, afterEach, before, describe, it } from 'node:test';

import { BANNER } from '../../../src/ohne/codegen/codegen-dir.ts';
import { generateBrowserLayers, loadLayers, useLayers } from '../../../src/ohne/index.ts';

describe('generateBrowserLayers', { skip: process.platform === 'win32' }, () => {
  let root: string;

  function write(path: string, content: string): void {
    mkdirSync(join(path, '..'), { recursive: true });
    writeFileSync(path, content);
  }

  function writeLayer(dir: string, name: string, config: object = {}, deps: string[] = []): void {
    const dependencies = Object.fromEntries(deps.map((dep) => [dep, '*']));
    write(join(dir, 'package.json'), JSON.stringify({ name, type: 'module', dependencies }));
    write(join(dir, 'ohne.config.ts'), `export default ${JSON.stringify(config)};\n`);
    for (const dep of deps) {
      mkdirSync(join(dir, 'node_modules'), { recursive: true });
      symlinkSync(join(root, 'store', dep), join(dir, 'node_modules', dep), 'dir');
    }
  }

  before(() => {
    root = realpathSync(mkdtempSync(join(tmpdir(), 'ohne-gen-browser-layers-')));
  });

  after(() => {
    rmSync(root, { recursive: true, force: true });
  });

  afterEach(() => {
    useLayers().clear();
  });

  it("imports each stacked layer's dashboard augmentations, furthest first", async () => {
    const app = join(root, 'app');
    const horde = join(root, 'store', 'horde');
    const scourge = join(root, 'store', 'scourge');
    writeLayer(horde, 'horde');
    writeLayer(scourge, 'scourge', { dirs: { dashboard: 'ui' } });
    writeLayer(app, 'app', { layers: ['scourge', 'horde'] }, ['scourge', 'horde']);
    write(join(horde, 'dashboard', 'fields.ts'), "declare module 'ohnejs/dashboard' {}\n");
    write(join(horde, 'dashboard', 'plain.ts'), 'export const orcs = 1;\n');
    write(join(horde, 'hooks.ts'), "declare module 'ohnejs/dashboard' {}\n");
    write(join(scourge, 'ui', 'meta.ts'), "declare module 'ohnejs/dashboard' {}\n");
    write(join(app, 'dashboard', 'own.ts'), "declare module 'ohnejs/dashboard' {}\n");

    await loadLayers(app);
    const path = await generateBrowserLayers(app);

    strictEqual(path, join(app, '.ohne', 'browser', 'layers.ts'));
    strictEqual(
      readFileSync(path, 'utf8'),
      `${BANNER}\n` +
        "import type {} from '../../../store/scourge/ui/meta.ts';\n" +
        "import type {} from '../../../store/horde/dashboard/fields.ts';\n",
    );
  });

  it('falls back to importing the dashboard module when nothing augments it', async () => {
    const app = join(root, 'bare');
    writeLayer(app, 'bare');

    await loadLayers(app);
    const path = await generateBrowserLayers(app);

    strictEqual(
      readFileSync(path!, 'utf8'),
      `${BANNER}\nimport type {} from 'ohnejs/dashboard';\n`,
    );
  });

  it('returns null when no package.json is found', async () => {
    strictEqual(await generateBrowserLayers(join(root, 'nowhere')), null);
  });
});
