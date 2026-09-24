import { strictEqual } from 'node:assert';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';

import { BANNER } from '../../../src/ohne/codegen/codegen-dir.ts';
import { generateResolvedConfig, useLayers } from '../../../src/ohne/index.ts';

describe('generateResolvedConfig', () => {
  let root: string;

  function makeApp(name: string): string {
    const dir = join(root, name);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ name }));
    return dir;
  }

  before(() => {
    root = mkdtempSync(join(tmpdir(), 'ohne-gen-config-'));
  });

  after(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('augments ConfigExtensions with a defaults tree from the layers', async () => {
    const app = makeApp('app');

    const layers = useLayers();
    layers.add({
      path: app,
      defaults: { collections: { defaultLocale: 'en' }, messages: { defaultLanguage: 'en' } },
    });
    try {
      const path = await generateResolvedConfig(app);
      strictEqual(path?.endsWith('/.ohne/node/resolved-config.ts'), true);
      strictEqual(
        readFileSync(path!, 'utf8'),
        `${BANNER}\n` +
          "import type {} from 'ohnejs';\n" +
          '\n' +
          "declare module 'ohnejs' {\n" +
          '  interface ConfigExtensions {\n' +
          '    defaults: {\n' +
          '      collections: {\n' +
          '        defaultLocale: true;\n' +
          '      };\n' +
          '      messages: {\n' +
          '        defaultLanguage: true;\n' +
          '      };\n' +
          '    };\n' +
          '  }\n' +
          '}\n',
      );
    } finally {
      layers.remove(app);
    }
  });

  it('leaves out a key marked own, since no default reaches it', async () => {
    const app = makeApp('own');

    const layers = useLayers();
    layers.add({ path: app, defaults: { dirs: { codegen: '.ohne' }, printer: { silent: false } } });
    try {
      const path = await generateResolvedConfig(app);
      strictEqual(readFileSync(path!, 'utf8').includes('interface ConfigExtensions {}'), true);
    } finally {
      layers.remove(app);
    }
  });

  it('stops at a replace path and at the entries of an assign path', async () => {
    const app = makeApp('whole');

    const layers = useLayers();
    layers.setStrategy('kit.style', 'replace');
    layers.setStrategy('kit.tags', 'assign');
    layers.add({
      path: app,
      defaults: { kit: { style: { color: 'red' }, tags: { a: { x: 1 } }, size: 2 } } as never,
    });
    try {
      const path = await generateResolvedConfig(app);
      strictEqual(
        readFileSync(path!, 'utf8'),
        `${BANNER}\n` +
          "import type {} from 'ohnejs';\n" +
          '\n' +
          "declare module 'ohnejs' {\n" +
          '  interface ConfigExtensions {\n' +
          '    defaults: {\n' +
          '      kit: {\n' +
          '        style: true;\n' +
          '        tags: {\n' +
          '          a: true;\n' +
          '        };\n' +
          '        size: true;\n' +
          '      };\n' +
          '    };\n' +
          '  }\n' +
          '}\n',
      );
    } finally {
      layers.clear();
    }
  });

  it('emits an empty interface when no layer ships defaults', async () => {
    const app = makeApp('empty');

    const path = await generateResolvedConfig(app);
    strictEqual(
      readFileSync(path!, 'utf8'),
      `${BANNER}\n` +
        "import type {} from 'ohnejs';\n" +
        '\n' +
        "declare module 'ohnejs' {\n" +
        '  interface ConfigExtensions {}\n' +
        '}\n',
    );
  });

  it('returns null when no package.json is found', async () => {
    strictEqual(await generateResolvedConfig(join(root, 'nowhere')), null);
  });
});
