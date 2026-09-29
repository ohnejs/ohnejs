import { strictEqual } from 'node:assert';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, afterEach, before, describe, it } from 'node:test';

import { BANNER } from '../../../src/ohne/codegen/codegen-dir.ts';
import { generateSkills, loadLayers, useLayers } from '../../../src/ohne/index.ts';

describe('generateSkills', () => {
  let root: string;

  function writePackage(at: string, name: string, config = 'export default {};\n'): void {
    mkdirSync(at, { recursive: true });
    writeFileSync(join(at, 'package.json'), JSON.stringify({ name, type: 'module' }));
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

  before(() => {
    root = realpathSync(mkdtempSync(join(tmpdir(), 'ohne-gen-skills-')));
  });

  after(() => {
    rmSync(root, { recursive: true, force: true });
  });

  afterEach(() => {
    useLayers().clear();
  });

  function bucket(paths: string[] | null, name: string): string {
    return readFileSync(paths!.find((path) => path.endsWith(`/.ohne/${name}/skills.ts`))!, 'utf8');
  }

  it('emits the shared name table, the `KnownSkills` extension, and registrations', async () => {
    const app = join(root, 'app');
    writePackage(app, 'app');
    writeSkill(app, 'summarize.ts', 'Summarize.');
    writeSkill(app, 'items/translate.ts', 'Translate.');

    await loadLayers(app);
    const paths = await generateSkills(app);
    const shared = bucket(paths, 'shared');
    const node = bucket(paths, 'node');

    strictEqual(shared.includes('export interface GeneratedSkills {'), true);
    strictEqual(shared.includes("'items-translate': true;"), true);
    strictEqual(shared.includes('summarize: true;'), true);
    strictEqual(shared.includes('export type GeneratedSkillName ='), true);
    strictEqual(node.includes("import type { GeneratedSkills } from '../shared/skills.ts';"), true);
    strictEqual(node.includes("import { useSkills } from 'ohnejs';"), true);
    strictEqual(node.includes("import s0 from '../../skills/items/translate.ts';"), true);
    strictEqual(node.includes("import s1 from '../../skills/summarize.ts';"), true);
    strictEqual(node.includes('interface KnownSkills extends GeneratedSkills {}'), true);
    strictEqual(node.includes('const skills = useSkills();'), true);
    strictEqual(
      node.includes("skills.register('items-translate', { name: 'items-translate', skill: s0 });"),
      true,
    );
    strictEqual(
      node.includes("skills.register('summarize', { name: 'summarize', skill: s1 });"),
      true,
    );
  });

  it('drops names in `disable.skills`', async () => {
    const app = join(root, 'disabled');
    writePackage(app, 'disabled', "export default { disable: { skills: ['summarize'] } };\n");
    writeSkill(app, 'summarize.ts', 'Summarize.');
    writeSkill(app, 'translate.ts', 'Translate.');

    await loadLayers(app);
    const paths = await generateSkills(app);
    const shared = bucket(paths, 'shared');
    const node = bucket(paths, 'node');

    strictEqual(shared.includes('translate: true;'), true);
    strictEqual(shared.includes('summarize'), false);
    strictEqual(node.includes('summarize'), false);
  });

  it('emits an empty interface when there are no skills', async () => {
    const app = join(root, 'empty');
    writePackage(app, 'empty');

    await loadLayers(app);
    const paths = await generateSkills(app);
    strictEqual(
      bucket(paths, 'shared'),
      `${BANNER}\n` +
        'export interface GeneratedSkills {}\n' +
        '\n' +
        'export type GeneratedSkillName = [keyof GeneratedSkills] extends [never] ? string : keyof GeneratedSkills;\n',
    );
    strictEqual(
      bucket(paths, 'node'),
      `${BANNER}\n` +
        "import type { GeneratedSkills } from '../shared/skills.ts';\n" +
        '\n' +
        "declare module 'ohnejs' {\n" +
        '  interface KnownSkills extends GeneratedSkills {}\n' +
        '}\n',
    );
  });

  it('returns null when no package.json is found', async () => {
    strictEqual(await generateSkills(join(root, 'nowhere')), null);
  });
});
