import { strictEqual } from 'node:assert';
import {
  mkdirSync,
  mkdtempSync,
  realpathSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import { pathToFileURL } from 'node:url';

import { registeredFiles } from '../../../src/ohne/codegen/registered-files.ts';

const UTILS = new URL('../../../src/utils/index.ts', import.meta.url).href;

describe('registeredFiles', () => {
  let root: string;

  async function emit(dir: string, file: string): Promise<string> {
    const module = join(dir, 'registered.ts');
    const expression = (await registeredFiles(dir))(file);
    writeFileSync(
      module,
      `import { resolvePath } from '${UTILS}';\nexport default ${expression};\n`,
    );
    return module;
  }

  async function load(module: string): Promise<string> {
    return ((await import(pathToFileURL(module).href)) as { default: string }).default;
  }

  before(() => {
    root = realpathSync(mkdtempSync(join(tmpdir(), 'ohne-registered-files-')));
  });

  after(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('resolves to the file it was given', async () => {
    const app = join(root, 'plain');
    const inside = join(app, 'api', 'index.get.ts');
    const outside = join(root, 'layer', 'api', 'index.get.ts');
    strictEqual(await load(await emit(join(app, '.ohne', 'node'), inside)), inside);
    strictEqual(await load(await emit(join(app, '.ohne', 'shared'), outside)), outside);
  });

  it('keeps the path of a project reached through a symlink', async () => {
    const app = join(root, 'real');
    mkdirSync(app);
    mkdirSync(join(root, 'links', 'deeper'), { recursive: true });
    const link = join(root, 'links', 'deeper', 'app');
    symlinkSync(app, link, 'dir');
    const inside = join(link, 'api', 'index.get.ts');
    const outside = join(root, 'layer', 'api', 'index.get.ts');
    strictEqual(await load(await emit(join(link, '.ohne', 'node'), inside)), inside);
    strictEqual(await load(await emit(join(link, '.ohne', 'shared'), outside)), outside);
  });

  it('follows the project to the directory it moved to', async () => {
    const module = await emit(
      join(root, 'build', '.ohne', 'node'),
      join(root, 'build', 'api', 'a.ts'),
    );
    renameSync(join(root, 'build'), join(root, 'slot'));
    strictEqual(await load(module.replace('/build/', '/slot/')), join(root, 'slot', 'api', 'a.ts'));
  });
});
