import { strictEqual } from 'node:assert';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, afterEach, before, describe, it } from 'node:test';

import { createFlowsTarget } from '../../../../src/ohne/dev/targets/flows.ts';
import { loadLayers, useLayers } from '../../../../src/ohne/index.ts';

/**
 * The source of a flow file whose one node is `start`.
 */
function flowSource(start: string): string {
  return `export default { description: 'd', start: '${start}', nodes: { ${start}: { act: { prompt: 'x' } } } };\n`;
}

describe('flows target', () => {
  let root: string;

  function writeApp(name: string): string {
    const app = join(root, name);
    mkdirSync(app, { recursive: true });
    writeFileSync(join(app, 'package.json'), JSON.stringify({ name, type: 'module' }));
    writeFileSync(join(app, 'ohne.config.ts'), '');
    return app;
  }

  function writeFlow(app: string, relative: string, content?: string): void {
    const file = join(app, 'flows', relative);
    mkdirSync(join(file, '..'), { recursive: true });
    writeFileSync(file, content ?? flowSource('go'));
  }

  before(() => {
    root = realpathSync(mkdtempSync(join(tmpdir(), 'ohne-flows-target-')));
  });

  after(() => {
    rmSync(root, { recursive: true, force: true });
  });

  afterEach(() => {
    useLayers().clear();
  });

  it('gates on its own dir and writes the table', async () => {
    const app = writeApp('regen');
    writeFlow(app, 'translate.ts');
    await loadLayers(app);
    const target = createFlowsTarget(app);
    const out = join(app, '.ohne', 'node', 'flows.ts');

    strictEqual(target.affectedBy(join(app, 'flows', 'translate.ts')), true);
    strictEqual(target.affectedBy(join(app, 'roles', 'editor.ts')), false);

    await target.regen();
    strictEqual(readFileSync(out, 'utf8').includes("'translate'"), true);
  });

  it('re-imports a fixed flow file past the module cache', async () => {
    const app = writeApp('fresh');
    writeFlow(app, 'translate.ts', 'export const nope = 1;\n');
    await loadLayers(app);
    const target = createFlowsTarget(app);

    await target.regen().then(
      () => strictEqual(true, false, 'a broken flow file must fail the regen'),
      () => {},
    );

    writeFlow(app, 'translate.ts');
    target.invalidate();
    await target.regen();
    const out = readFileSync(join(app, '.ohne', 'node', 'flows.ts'), 'utf8');
    strictEqual(out.includes("flows.register('translate'"), true);
  });
});
