import { deepStrictEqual, strictEqual } from 'node:assert';
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
import { generateBrowserTSConfig, loadLayers, useLayers } from '../../../src/ohne/index.ts';

interface BrowserTSConfig {
  extends: string;
  compilerOptions: { paths: { 'app/*': string[] } };
  include: string[];
}

describe('generateBrowserTSConfig', () => {
  let root: string;

  function writeLayer(
    dir: string,
    name: string,
    config: Record<string, unknown>,
    deps: string[] = [],
  ): void {
    mkdirSync(dir, { recursive: true });
    const dependencies = Object.fromEntries(deps.map((dep) => [dep, '*']));
    writeFileSync(
      join(dir, 'package.json'),
      JSON.stringify({ name, type: 'module', dependencies }),
    );
    writeFileSync(join(dir, 'ohne.config.ts'), `export default ${JSON.stringify(config)}\n`);
  }

  async function generate(app: string): Promise<{ path: string; config: BrowserTSConfig }> {
    await loadLayers(app);
    const path = (await generateBrowserTSConfig(app)) ?? '';
    const lines = readFileSync(path, 'utf8').split('\n');
    strictEqual(lines[0], BANNER);
    return { path, config: JSON.parse(lines.slice(1).join('\n')) as BrowserTSConfig };
  }

  before(() => {
    root = realpathSync(mkdtempSync(join(tmpdir(), 'ohne-gen-browser-tsconfig-')));
  });

  after(() => {
    rmSync(root, { recursive: true, force: true });
  });

  afterEach(() => {
    useLayers().clear();
  });

  it('extends the framework browser tsconfig and covers the dashboard and both buckets', async () => {
    const app = join(root, 'app');
    writeLayer(app, 'app', {});

    const { path, config } = await generate(app);

    strictEqual(path, join(app, '.ohne', 'browser', 'tsconfig.json'));
    strictEqual(config.extends, 'ohnejs/tsconfig.browser.json');
    deepStrictEqual(config.compilerOptions.paths['app/*'], ['../../dashboard/*']);
    deepStrictEqual(config.include, ['../../dashboard/**/*.ts', '../shared/**/*.ts', './**/*.ts']);
  });

  it(
    "maps app/* onto every stacked layer closest first, from each layer's own dirs",
    { skip: process.platform === 'win32' },
    async () => {
      const store = join(root, 'stacked', 'store');
      const app = join(root, 'stacked', 'app');
      writeLayer(join(store, 'a'), 'a', { dirs: { dashboard: 'ui' } });
      writeLayer(
        app,
        'stacked',
        { layers: ['a'], dirs: { dashboard: 'src/ui', codegen: 'generated' } },
        ['a'],
      );
      mkdirSync(join(app, 'node_modules'), { recursive: true });
      symlinkSync(join(store, 'a'), join(app, 'node_modules', 'a'), 'dir');

      const { path, config } = await generate(app);

      strictEqual(path, join(app, 'generated', 'browser', 'tsconfig.json'));
      deepStrictEqual(config.compilerOptions.paths['app/*'], [
        '../../src/ui/*',
        '../../../store/a/ui/*',
      ]);
      deepStrictEqual(config.include, ['../../src/ui/**/*.ts', '../shared/**/*.ts', './**/*.ts']);
    },
  );
});
