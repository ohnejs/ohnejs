import { strictEqual } from 'node:assert';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, afterEach, before, describe, it } from 'node:test';

import { createSkillsTarget } from '../../../../src/ohne/dev/targets/skills.ts';
import { loadLayers, useLayers } from '../../../../src/ohne/index.ts';

describe('skills target', () => {
  let root: string;

  function writeApp(name: string): string {
    const app = join(root, name);
    mkdirSync(app, { recursive: true });
    writeFileSync(join(app, 'package.json'), JSON.stringify({ name, type: 'module' }));
    writeFileSync(join(app, 'ohne.config.ts'), '');
    return app;
  }

  function writeSkill(app: string, relative: string, content?: string): void {
    const file = join(app, 'skills', relative);
    mkdirSync(join(file, '..'), { recursive: true });
    writeFileSync(file, content ?? "export default { description: 'd', prompt: 'Translate.' };\n");
  }

  before(() => {
    root = realpathSync(mkdtempSync(join(tmpdir(), 'ohne-skills-target-')));
  });

  after(() => {
    rmSync(root, { recursive: true, force: true });
  });

  afterEach(() => {
    useLayers().clear();
  });

  it('gates on its own dir and writes the table', async () => {
    const app = writeApp('regen');
    writeSkill(app, 'translate.ts');
    await loadLayers(app);
    const target = createSkillsTarget(app);
    const out = join(app, '.ohne', 'node', 'skills.ts');

    strictEqual(target.affectedBy(join(app, 'skills', 'translate.ts')), true);
    strictEqual(target.affectedBy(join(app, 'roles', 'editor.ts')), false);

    await target.regen();
    strictEqual(readFileSync(out, 'utf8').includes("'translate'"), true);
  });

  it('re-imports a fixed skill file past the module cache', async () => {
    const app = writeApp('fresh');
    writeSkill(app, 'translate.ts', 'export const nope = 1;\n');
    await loadLayers(app);
    const target = createSkillsTarget(app);

    await target.regen().then(
      () => strictEqual(true, false, 'a broken skill file must fail the regen'),
      () => {},
    );

    writeSkill(app, 'translate.ts');
    target.invalidate();
    await target.regen();
    const out = readFileSync(join(app, '.ohne', 'node', 'skills.ts'), 'utf8');
    strictEqual(out.includes("skills.register('translate'"), true);
  });
});
