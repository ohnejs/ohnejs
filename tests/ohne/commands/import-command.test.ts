import { ok, rejects, strictEqual } from 'node:assert';
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import { pathToFileURL } from 'node:url';

import { importCommand, isOhneError } from '../../../src/ohne/index.ts';

describe('importCommand', () => {
  let root: string;

  function writeCommand(name: string, source: string): string {
    const file = join(root, name);
    writeFileSync(file, source);
    return file;
  }

  before(() => {
    root = realpathSync(mkdtempSync(join(tmpdir(), 'ohne-import-command-')));
  });

  after(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("returns the file's default-exported definition", async () => {
    const file = writeCommand(
      'seedDatabase.ts',
      "export default { meta: { name: 'seed-database' }, run() {} };\n",
    );
    const { default: definition } = await import(pathToFileURL(file).href);
    strictEqual(await importCommand({ name: 'seed-database', file }), definition);
  });

  it('rejects a file without a default export, at its path', async () => {
    const file = writeCommand('missing.ts', "export const meta = { name: 'missing' };\n");
    await rejects(importCommand({ name: 'missing', file }), (error: unknown) => {
      ok(isOhneError(error));
      strictEqual(error.title, 'Command `missing` has no definition');
      strictEqual(error.path, file);
      return true;
    });
  });

  it('rejects a default export that is not a command definition', async () => {
    const exports = [
      "Object.assign(() => {}, { meta: { name: 'invalid' } })",
      '{ run() {} }',
      "{ meta: { description: 'Seed the database.' } }",
    ];
    for (const [i, value] of exports.entries()) {
      const file = writeCommand(`invalid-${i}.ts`, `export default ${value};\n`);
      await rejects(
        importCommand({ name: 'invalid', file }),
        /Command `invalid` has no definition/,
      );
    }
  });

  it('rejects a `meta.name` other than the name the file derives', async () => {
    const file = writeCommand('warmCache.ts', "export default { meta: { name: 'warmCache' } };\n");
    await rejects(importCommand({ name: 'warm-cache', file }), (error: unknown) => {
      ok(isOhneError(error));
      strictEqual(error.title, 'Command `warm-cache` is named `warmCache`');
      strictEqual(error.path, file);
      return true;
    });
  });
});
