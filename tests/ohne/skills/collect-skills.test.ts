import { deepStrictEqual, rejects } from 'node:assert';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, afterEach, before, describe, it } from 'node:test';

import { collectSkills, loadLayers, useLayers } from '../../../src/ohne/index.ts';
import { stackedLayers } from '../../../src/ohne/layers/stacked-layers.ts';

describe('collectSkills', () => {
  let root: string;

  function writePackage(at: string, name: string, config: string, layers?: string[]): void {
    mkdirSync(at, { recursive: true });
    const dependencies = Object.fromEntries((layers ?? []).map((layer) => [layer, '*']));
    writeFileSync(join(at, 'package.json'), JSON.stringify({ name, type: 'module', dependencies }));
    writeFileSync(join(at, 'ohne.config.ts'), config);
  }

  function writeSkill(dir: string, relative: string, prompt: string): void {
    const file = join(dir, 'skills', relative);
    mkdirSync(join(file, '..'), { recursive: true });
    writeFileSync(
      file,
      `export default { description: 'd', prompt: ${JSON.stringify(prompt)} };\n`,
    );
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
    root = realpathSync(mkdtempSync(join(tmpdir(), 'ohne-collect-skills-')));
  });

  after(() => {
    rmSync(root, { recursive: true, force: true });
  });

  afterEach(() => {
    useLayers().clear();
  });

  it('imports each definition, a closer layer replacing a further one by name', async () => {
    await appWith('override', (app, dep) => {
      writeSkill(dep, 'summarize.ts', 'Summarize.');
      writeSkill(dep, 'translate-items.ts', 'Translate roughly.');
      writeSkill(app, 'translate-items.ts', 'Translate exactly.');
    });
    const collected = await collectSkills(stackedLayers());
    deepStrictEqual(
      collected.map((skill) => skill.name),
      ['summarize', 'translate-items'],
    );
    deepStrictEqual(collected[1]?.skill.prompt, 'Translate exactly.');
  });

  it('drops disabled names after the merge', async () => {
    await appWith('disabled', (app) => {
      writeSkill(app, 'summarize.ts', 'Summarize.');
      writeSkill(app, 'translate-items.ts', 'Translate.');
    });
    const collected = await collectSkills(stackedLayers(), { disable: ['summarize'] });
    deepStrictEqual(
      collected.map((skill) => skill.name),
      ['translate-items'],
    );
  });

  it('reads each layer from its own `dirs.skills`', async () => {
    await appWith('dirs', (app, dep) => {
      writeFileSync(
        join(app, 'ohne.config.ts'),
        "export default { layers: ['dep'], dirs: { skills: 'prompts' } };\n",
      );
      const file = join(app, 'prompts', 'rename.ts');
      mkdirSync(join(file, '..'), { recursive: true });
      writeFileSync(file, "export default { description: 'd', prompt: 'Rename.' };\n");
      writeSkill(app, 'ignored.ts', 'Ignored.');
      writeSkill(dep, 'summarize.ts', 'Summarize.');
    });
    const collected = await collectSkills(stackedLayers());
    deepStrictEqual(
      collected.map((skill) => skill.name),
      ['rename', 'summarize'],
    );
  });

  it('rejects a file without a definition default export', async () => {
    await appWith('empty', (app) => {
      const file = join(app, 'skills', 'translate-items.ts');
      mkdirSync(join(file, '..'), { recursive: true });
      writeFileSync(file, 'export const translate = 1;\n');
    });
    await rejects(collectSkills(stackedLayers()), /`translate-items` has no definition/);
  });
});
