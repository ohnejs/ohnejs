import { strictEqual } from 'node:assert';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, afterEach, before, describe, it } from 'node:test';

import { BANNER } from '../../../src/ohne/codegen/codegen-dir.ts';
import { generateFlows, loadLayers, useLayers } from '../../../src/ohne/index.ts';

/**
 * The source of a flow file whose one node is `start`.
 */
function flowSource(start: string): string {
  return `export default { description: 'd', start: '${start}', nodes: { ${start}: { act: { prompt: 'x' } } } };\n`;
}

describe('generateFlows', () => {
  let root: string;

  function writePackage(at: string, name: string, config = 'export default {};\n'): void {
    mkdirSync(at, { recursive: true });
    writeFileSync(join(at, 'package.json'), JSON.stringify({ name, type: 'module' }));
    writeFileSync(join(at, 'ohne.config.ts'), config);
  }

  function writeFlow(dir: string, relative: string): void {
    const file = join(dir, 'flows', relative);
    mkdirSync(join(file, '..'), { recursive: true });
    writeFileSync(file, flowSource('go'));
  }

  before(() => {
    root = realpathSync(mkdtempSync(join(tmpdir(), 'ohne-gen-flows-')));
  });

  after(() => {
    rmSync(root, { recursive: true, force: true });
  });

  afterEach(() => {
    useLayers().clear();
  });

  function bucket(paths: string[] | null, name: string): string {
    return readFileSync(paths!.find((path) => path.endsWith(`/.ohne/${name}/flows.ts`))!, 'utf8');
  }

  it('emits the shared name table, the `KnownFlows` extension, and registrations', async () => {
    const app = join(root, 'app');
    writePackage(app, 'app');
    writeFlow(app, 'summarize.ts');
    writeFlow(app, 'items/translate.ts');

    await loadLayers(app);
    const paths = await generateFlows(app);
    const shared = bucket(paths, 'shared');
    const node = bucket(paths, 'node');

    strictEqual(shared.includes('export interface GeneratedFlows {'), true);
    strictEqual(shared.includes("'items-translate': true;"), true);
    strictEqual(shared.includes('summarize: true;'), true);
    strictEqual(shared.includes('export type GeneratedFlowName ='), true);
    strictEqual(node.includes("import type { GeneratedFlows } from '../shared/flows.ts';"), true);
    strictEqual(node.includes("import { useFlows } from 'ohnejs';"), true);
    strictEqual(node.includes("import f0 from '../../flows/items/translate.ts';"), true);
    strictEqual(node.includes("import f1 from '../../flows/summarize.ts';"), true);
    strictEqual(node.includes('interface KnownFlows extends GeneratedFlows {}'), true);
    strictEqual(node.includes('const flows = useFlows();'), true);
    strictEqual(
      node.includes("flows.register('items-translate', { name: 'items-translate', flow: f0 });"),
      true,
    );
    strictEqual(
      node.includes("flows.register('summarize', { name: 'summarize', flow: f1 });"),
      true,
    );
  });

  it('drops names in `disable.flows`', async () => {
    const app = join(root, 'disabled');
    writePackage(app, 'disabled', "export default { disable: { flows: ['summarize'] } };\n");
    writeFlow(app, 'summarize.ts');
    writeFlow(app, 'translate.ts');

    await loadLayers(app);
    const paths = await generateFlows(app);
    const shared = bucket(paths, 'shared');
    const node = bucket(paths, 'node');

    strictEqual(shared.includes('translate: true;'), true);
    strictEqual(shared.includes('summarize'), false);
    strictEqual(node.includes('summarize'), false);
  });

  it('emits an empty interface when there are no flows', async () => {
    const app = join(root, 'empty');
    writePackage(app, 'empty');

    await loadLayers(app);
    const paths = await generateFlows(app);
    strictEqual(
      bucket(paths, 'shared'),
      `${BANNER}\n` +
        'export interface GeneratedFlows {}\n' +
        '\n' +
        'export type GeneratedFlowName = [keyof GeneratedFlows] extends [never] ? string : keyof GeneratedFlows;\n',
    );
    strictEqual(
      bucket(paths, 'node'),
      `${BANNER}\n` +
        "import type { GeneratedFlows } from '../shared/flows.ts';\n" +
        '\n' +
        "declare module 'ohnejs' {\n" +
        '  interface KnownFlows extends GeneratedFlows {}\n' +
        '}\n',
    );
  });

  it('returns null when no package.json is found', async () => {
    strictEqual(await generateFlows(join(root, 'nowhere')), null);
  });
});
