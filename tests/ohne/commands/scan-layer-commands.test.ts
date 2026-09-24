import { deepStrictEqual, ok, rejects, strictEqual } from 'node:assert';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { after, before, describe, it } from 'node:test';

import { isOhneError, scanLayerCommands } from '../../../src/ohne/index.ts';

describe('scanLayerCommands', () => {
  let root: string;

  function writeCommand(dir: string, name: string): string {
    const file = join(dir, 'commands', name);
    mkdirSync(join(file, '..'), { recursive: true });
    writeFileSync(file, 'export default null;\n');
    return file;
  }

  before(() => {
    root = realpathSync(mkdtempSync(join(tmpdir(), 'ohne-scan-commands-')));
  });

  after(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('names each command by its kebab-cased file name', async () => {
    const dir = join(root, 'named');
    const sync = writeCommand(dir, 's3-sync.ts');
    const seed = writeCommand(dir, 'seedDatabase.ts');
    deepStrictEqual(await scanLayerCommands({ name: 'app', dir }, 'commands'), [
      { name: 's3-sync', file: sync },
      { name: 'seed-database', file: seed },
    ]);
  });

  it('sorts by file name, digit runs numerically', async () => {
    const dir = join(root, 'sorted');
    writeCommand(dir, 'seed.ts');
    writeCommand(dir, '10-rebuild.ts');
    writeCommand(dir, '2-warm.ts');
    writeCommand(dir, 'backup.ts');
    const scanned = await scanLayerCommands({ name: 'app', dir }, 'commands');
    deepStrictEqual(
      scanned.map((command) => command.name),
      ['2-warm', '10-rebuild', 'backup', 'seed'],
    );
  });

  it('reads the directory it is given', async () => {
    const dir = join(root, 'custom');
    const file = join(dir, 'cli', 'seed.ts');
    mkdirSync(join(dir, 'cli'), { recursive: true });
    writeFileSync(file, 'export default null;\n');
    writeCommand(dir, 'stale.ts');
    deepStrictEqual(await scanLayerCommands({ name: 'app', dir }, 'cli'), [{ name: 'seed', file }]);
  });

  it('skips `_`-prefixed helper files', async () => {
    const dir = join(root, 'helpers');
    writeCommand(dir, 'seed.ts');
    writeCommand(dir, '_shared.ts');
    const scanned = await scanLayerCommands({ name: 'app', dir }, 'commands');
    deepStrictEqual(
      scanned.map((command) => command.name),
      ['seed'],
    );
  });

  it('ignores nested files and files other than `.ts`', async () => {
    const dir = join(root, 'nested');
    writeCommand(dir, 'uploads.ts');
    writeCommand(dir, 'uploads/prune.ts');
    writeCommand(dir, 'uploads/index.ts');
    writeCommand(dir, 'notes.md');
    const scanned = await scanLayerCommands({ name: 'app', dir }, 'commands');
    deepStrictEqual(
      scanned.map((command) => command.name),
      ['uploads'],
    );
  });

  it('rejects `index.ts`, which names no command, at its path', async () => {
    const dir = join(root, 'index');
    writeCommand(dir, 'seed.ts');
    const file = writeCommand(dir, 'index.ts');
    await rejects(scanLayerCommands({ name: 'app', dir }, 'commands'), (error: unknown) => {
      ok(isOhneError(error));
      strictEqual(error.title, '`index.ts` names no command');
      strictEqual(error.path, file);
      return true;
    });
  });

  it('rejects two files resolving to the same name, naming both', async () => {
    const dir = join(root, 'duplicate');
    const first = writeCommand(dir, 'seed-db.ts');
    const second = writeCommand(dir, 'seedDb.ts');
    await rejects(scanLayerCommands({ name: 'app', dir }, 'commands'), (error: unknown) => {
      ok(isOhneError(error));
      strictEqual(error.title, 'Duplicate command `seed-db`');
      deepStrictEqual(error.body, [
        'Two files in layer `app` resolve to the same name.',
        '',
        `- \`${relative(process.cwd(), first)}\``,
        `- \`${relative(process.cwd(), second)}\``,
      ]);
      return true;
    });
  });

  it('rejects a file name holding URL syntax', async () => {
    const dir = join(root, 'unimportable');
    writeCommand(dir, 'seed#1.ts');
    await rejects(
      scanLayerCommands({ name: 'app', dir }, 'commands'),
      /Unsupported character `#` in a command path/,
    );
  });

  it('returns an empty list when the layer has no commands directory', async () => {
    deepStrictEqual(
      await scanLayerCommands({ name: 'app', dir: join(root, 'none') }, 'commands'),
      [],
    );
  });
});
