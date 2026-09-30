import { deepStrictEqual, rejects } from 'node:assert';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, afterEach, before, describe, it } from 'node:test';

import { collectFlows, isOhneError, loadLayers, useLayers } from '../../../src/ohne/index.ts';
import { stackedLayers } from '../../../src/ohne/layers/stacked-layers.ts';

/**
 * The source of a flow file whose one node is `start`.
 */
function flowSource(start: string): string {
  return `export default { description: 'd', start: '${start}', nodes: { ${start}: { act: { prompt: 'x' } } } };\n`;
}

describe('collectFlows', () => {
  let root: string;

  function writePackage(at: string, name: string, config: string, layers?: string[]): void {
    mkdirSync(at, { recursive: true });
    const dependencies = Object.fromEntries((layers ?? []).map((layer) => [layer, '*']));
    writeFileSync(join(at, 'package.json'), JSON.stringify({ name, type: 'module', dependencies }));
    writeFileSync(join(at, 'ohne.config.ts'), config);
  }

  function writeFlow(dir: string, relative: string, start: string): void {
    const file = join(dir, 'flows', relative);
    mkdirSync(join(file, '..'), { recursive: true });
    writeFileSync(file, flowSource(start));
  }

  async function appWith(name: string, write: (app: string, dep: string) => void): Promise<string> {
    const app = join(root, name);
    writePackage(app, name, "export default { layers: ['dep'] };\n", ['dep']);
    const dep = join(app, 'packages', 'dep');
    writePackage(dep, 'dep', 'export default {};\n');
    mkdirSync(join(app, 'node_modules'), { recursive: true });
    symlinkSync(dep, join(app, 'node_modules', 'dep'), 'dir');
    write(app, dep);
    await loadLayers(app);
    return app;
  }

  before(() => {
    root = realpathSync(mkdtempSync(join(tmpdir(), 'ohne-collect-flows-')));
  });

  after(() => {
    rmSync(root, { recursive: true, force: true });
  });

  afterEach(() => {
    useLayers().clear();
  });

  it('imports each definition, a closer layer replacing a further one by name', async () => {
    await appWith('override', (app, dep) => {
      writeFlow(dep, 'summarize.ts', 'sum');
      writeFlow(dep, 'translate-items.ts', 'rough');
      writeFlow(app, 'translate-items.ts', 'exact');
    });
    const collected = await collectFlows(stackedLayers());
    deepStrictEqual(
      collected.map((flow) => flow.name),
      ['summarize', 'translate-items'],
    );
    deepStrictEqual(collected[1]?.flow.start, 'exact');
  });

  it('drops disabled names after the merge', async () => {
    await appWith('disabled', (app) => {
      writeFlow(app, 'summarize.ts', 'sum');
      writeFlow(app, 'translate-items.ts', 'go');
    });
    const collected = await collectFlows(stackedLayers(), { disable: ['summarize'] });
    deepStrictEqual(
      collected.map((flow) => flow.name),
      ['translate-items'],
    );
  });

  it('reads each layer from its own `dirs.flows`', async () => {
    await appWith('dirs', (app, dep) => {
      writeFileSync(
        join(app, 'ohne.config.ts'),
        "export default { layers: ['dep'], dirs: { flows: 'graphs' } };\n",
      );
      const file = join(app, 'graphs', 'rename.ts');
      mkdirSync(join(file, '..'), { recursive: true });
      writeFileSync(file, flowSource('go'));
      writeFlow(app, 'ignored.ts', 'go');
      writeFlow(dep, 'summarize.ts', 'go');
    });
    const collected = await collectFlows(stackedLayers());
    deepStrictEqual(
      collected.map((flow) => flow.name),
      ['rename', 'summarize'],
    );
  });

  it('rejects a file without a definition default export', async () => {
    await appWith('empty', (app) => {
      const file = join(app, 'flows', 'translate-items.ts');
      mkdirSync(join(file, '..'), { recursive: true });
      writeFileSync(file, 'export const translate = 1;\n');
    });
    await rejects(collectFlows(stackedLayers()), /`translate-items` has no definition/);
  });

  it('points an invalid definition at its file', async () => {
    const index = join(import.meta.dirname, '../../../src/ohne/index.ts');
    let file = '';
    await appWith('invalid', (app) => {
      file = join(app, 'flows', 'triage.ts');
      mkdirSync(join(file, '..'), { recursive: true });
      writeFileSync(
        file,
        `import { defineFlow } from '${index}';\n` +
          "export default defineFlow({ description: 'd', start: 'a', nodes: { a: { decide: { questions: { q: { yesNo: 'Q?' } } }, next: 'a' } } });\n",
      );
    });
    await rejects(
      collectFlows(stackedLayers()),
      (error) =>
        isOhneError(error) && error.message === 'Invalid flow definition' && error.path === file,
    );
  });
});
