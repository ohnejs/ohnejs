import {
  createCodeBuilder,
  createCodeGenerator,
  importSpecifier,
  literalString,
  propertyKey,
} from '../../utils/codegen/index.ts';
import { isNull } from '../../utils/index.ts';
import { stackedLayers } from '../layers/stacked-layers.ts';
import { useConfig } from '../layers/use-config.ts';
import { collectSkills } from '../skills/collect-skills.ts';
import { BANNER, codegenBucket } from './codegen-dir.ts';

/**
 * Options for `generateSkills`.
 */
export interface GenerateSkillsOptions {
  /**
   * Re-import each skill definition fresh, past the module cache.
   * The dev supervisor sets it to pick up edits in its own long-lived process.
   *
   * @default
   * false
   */
  fresh?: boolean;
}

/**
 * Generates the skill tables from every layer's skills directory.
 *
 * Emits `shared/skills.ts`, the pure name table: `GeneratedSkills` and the `GeneratedSkillName` union.
 * It is import-free, so both type programs load it; with no skills the union falls back to `string`.
 * Emits `node/skills.ts`, which extends `KnownSkills` from it and registers each skill into `useSkills`.
 * Each skill is statically imported from its source file by relative path.
 *
 * Skills are read from each layer's `Config.dirs.skills` directory and combined.
 * Layers come from the registered stack, so `loadLayers` must have run first.
 * A closer layer overrides an earlier skill with the same name.
 * Names in `Config.disable.skills` drop before emission.
 *
 * The app root is the nearest `package.json` above `from` (default `process.cwd()`).
 * Output lands in the `shared` and `node` buckets of the app's `dirs.codegen` (default `.ohne`).
 *
 * A file is rewritten only when its contents change.
 * Returns the absolute paths written, or `null` when no `package.json` is found.
 */
export async function generateSkills(
  from: string = process.cwd(),
  options: GenerateSkillsOptions = {},
): Promise<string[] | null> {
  const sharedDir = await codegenBucket(from, 'shared');
  const nodeDir = await codegenBucket(from, 'node');
  if (isNull(sharedDir) || isNull(nodeDir)) return null;

  const { fresh = false } = options;
  const skills = await collectSkills(stackedLayers(), {
    disable: useConfig().disable.skills,
    fresh,
  });

  const shared = createCodeBuilder();
  if (skills.length === 0) {
    shared.line('export interface GeneratedSkills {}');
  } else {
    shared.line('export interface GeneratedSkills {');
    shared.indent(() => {
      skills.forEach((skill) => shared.line(`${propertyKey(skill.name)}: true;`));
    });
    shared.line('}');
  }
  shared.line();
  shared.line(
    'export type GeneratedSkillName = [keyof GeneratedSkills] extends [never] ? string : keyof GeneratedSkills;',
  );

  const code = createCodeBuilder();
  code.line("import type { GeneratedSkills } from '../shared/skills.ts';");
  if (skills.length > 0) code.line("import { useSkills } from 'ohnejs';");
  skills.forEach((skill, index) => {
    code.line(`import s${index} from ${literalString(importSpecifier(nodeDir, skill.file))};`);
  });
  code.line();

  code.line("declare module 'ohnejs' {");
  code.indent(() => {
    code.line('interface KnownSkills extends GeneratedSkills {}');
  });
  code.line('}');

  if (skills.length > 0) {
    code.line();
    code.line('const skills = useSkills();');
    skills.forEach((skill, index) => {
      const name = literalString(skill.name);
      code.line(`skills.register(${name}, { name: ${name}, skill: s${index} });`);
    });
  }

  const sharedGen = createCodeGenerator({ dir: sharedDir, banner: BANNER });
  await sharedGen.write('skills.ts', shared.toString());
  const nodeGen = createCodeGenerator({ dir: nodeDir, banner: BANNER });
  await nodeGen.write('skills.ts', code.toString());
  return [sharedGen.path('skills.ts'), nodeGen.path('skills.ts')];
}
