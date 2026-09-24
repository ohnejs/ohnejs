import { deepStrictEqual } from 'node:assert';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, afterEach, before, describe, it } from 'node:test';

import { collectCommands, loadLayers, stackedLayers, useLayers } from '../../../src/ohne/index.ts';

describe('collectCommands', () => {
  let root: string;

  function writePackage(at: string, name: string, config: string, layers?: string[]): void {
    mkdirSync(at, { recursive: true });
    const dependencies = Object.fromEntries((layers ?? []).map((layer) => [layer, '*']));
    writeFileSync(join(at, 'package.json'), JSON.stringify({ name, type: 'module', dependencies }));
    writeFileSync(join(at, 'ohne.config.ts'), config);
  }

  function writeCommand(file: string, source = 'export default null;\n'): string {
    mkdirSync(join(file, '..'), { recursive: true });
    writeFileSync(file, source);
    return file;
  }

  async function appWith(
    name: string,
    depConfig = 'export default {};\n',
  ): Promise<{ app: string; dep: string }> {
    const app = join(root, name);
    writePackage(app, name, "export default { layers: ['dep'] };\n", ['dep']);
    const dep = join(app, 'packages', 'dep');
    writePackage(dep, 'dep', depConfig);
    mkdirSync(join(app, 'node_modules'), { recursive: true });
    symlinkSync(dep, join(app, 'node_modules', 'dep'), 'dir');
    await loadLayers(app);
    return { app, dep };
  }

  before(() => {
    root = realpathSync(mkdtempSync(join(tmpdir(), 'ohne-collect-commands-')));
  });

  after(() => {
    rmSync(root, { recursive: true, force: true });
  });

  afterEach(() => {
    useLayers().clear();
  });

  it('lets a closer layer replace a further one by name', async () => {
    const { app, dep } = await appWith('override');
    const backup = writeCommand(join(dep, 'commands', 'backup.ts'));
    writeCommand(join(dep, 'commands', 'seed.ts'));
    const seed = writeCommand(join(app, 'commands', 'seed.ts'));
    deepStrictEqual(await collectCommands(stackedLayers()), [
      { name: 'backup', file: backup },
      { name: 'seed', file: seed },
    ]);
  });

  it('sorts the merged commands by name, digit runs numerically', async () => {
    const { app, dep } = await appWith('sorted');
    writeCommand(join(dep, 'commands', 'seed.ts'));
    writeCommand(join(dep, 'commands', '10-rebuild.ts'));
    writeCommand(join(app, 'commands', '2-warm.ts'));
    writeCommand(join(app, 'commands', 'backup.ts'));
    const collected = await collectCommands(stackedLayers());
    deepStrictEqual(
      collected.map((command) => command.name),
      ['2-warm', '10-rebuild', 'backup', 'seed'],
    );
  });

  it("scans each layer in its own `dirs.commands`, never inheriting another layer's", async () => {
    const { app, dep } = await appWith('dirs', "export default { dirs: { commands: 'tools' } };\n");
    writeCommand(join(dep, 'tools', 'migrate.ts'));
    writeCommand(join(dep, 'commands', 'stale.ts'));
    writeCommand(join(app, 'commands', 'seed.ts'));
    const collected = await collectCommands(stackedLayers());
    deepStrictEqual(
      collected.map((command) => command.name),
      ['migrate', 'seed'],
    );
  });

  it('imports none of the command files', async () => {
    const { app } = await appWith('lazy');
    writeCommand(join(app, 'commands', 'seed.ts'), "throw new Error('imported');\n");
    const collected = await collectCommands(stackedLayers());
    deepStrictEqual(
      collected.map((command) => command.name),
      ['seed'],
    );
  });
});
