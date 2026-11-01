import { rejects, strictEqual } from 'node:assert';
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, afterEach, before, describe, it } from 'node:test';

import { createContractsTarget } from '../../../../src/ohne/dev/targets/contracts.ts';
import { loadLayers, useLayers } from '../../../../src/ohne/index.ts';

const ROUTES = "export interface Routes {\n  'GET /a': { response: Row };\n}\n";

describe('contracts target', () => {
  let root: string;

  function write(file: string, content: string): void {
    mkdirSync(join(file, '..'), { recursive: true });
    writeFileSync(file, content);
  }

  function writeApp(name: string, config: string): string {
    const app = join(root, name);
    write(join(app, 'package.json'), JSON.stringify({ name, type: 'module' }));
    write(join(app, 'ohne.config.ts'), `export default ${config};\n`);
    write(join(app, 'types', 'row.ts'), 'export interface Row {\n  id: string;\n}\n');
    write(join(app, 'ohne.contract.ts'), `import type { Row } from './types/row.ts';\n\n${ROUTES}`);
    return app;
  }

  before(() => {
    root = realpathSync(mkdtempSync(join(tmpdir(), 'ohne-contracts-target-')));
  });

  after(() => {
    rmSync(root, { recursive: true, force: true });
  });

  afterEach(() => {
    useLayers().clear();
  });

  it('gates on the contract, the route dirs, and with `api.types` every contract module', async () => {
    const app = writeApp('typed', "{ api: { types: 'ohne.ts' } }");
    await loadLayers(app);
    const target = createContractsTarget(app);

    strictEqual(target.affectedBy(join(app, 'ohne.contract.ts')), true);
    strictEqual(target.affectedBy(join(app, 'api', 'a.get.ts')), true);
    strictEqual(target.affectedBy(join(app, 'types', 'row.ts')), false);
    strictEqual(target.affectedBy(join(app, 'lib.ts')), false);

    await target.regen();
    strictEqual(target.affectedBy(join(app, 'types', 'row.ts')), true);
    strictEqual(existsSync(join(app, '.ohne', 'node', 'contracts.ts')), true);
  });

  it('reads no contract module without `api.types`', async () => {
    const app = writeApp('untyped', '{}');
    write(join(app, 'types', 'row.ts'), 'export const row = 1;\n');
    await loadLayers(app);
    const target = createContractsTarget(app);

    await target.regen();

    strictEqual(target.affectedBy(join(app, 'types', 'row.ts')), false);
  });

  it('keeps watching a module that refuses, so its fix reruns the target', async () => {
    const app = writeApp('refused', "{ api: { types: 'ohne.ts' } }");
    write(join(app, 'types', 'row.ts'), 'export const row = 1;\n');
    await loadLayers(app);
    const target = createContractsTarget(app);

    await rejects(target.regen(), /holds runtime code/);

    strictEqual(target.affectedBy(join(app, 'types', 'row.ts')), true);
  });

  it('reruns once a missing contract import appears', async () => {
    const app = writeApp('missing', "{ api: { types: 'ohne.ts' } }");
    rmSync(join(app, 'types', 'row.ts'));
    await loadLayers(app);
    const target = createContractsTarget(app);

    await rejects(target.regen(), /Cannot resolve/);
    strictEqual(target.affectedBy(join(app, 'types', 'row.ts')), true);

    write(join(app, 'types', 'row.ts'), 'export interface Row {\n  id: string;\n}\n');
    await target.regen();
    strictEqual(target.affectedBy(join(app, 'lib.ts')), false);
  });
});
