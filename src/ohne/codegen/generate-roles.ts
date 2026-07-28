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
import { collectRoles } from '../roles/collect-roles.ts';
import { BANNER, codegenBucket } from './codegen-dir.ts';

/**
 * Options for `generateRoles`.
 */
export interface GenerateRolesOptions {
  /**
   * Re-import each role definition fresh, past the module cache.
   * The dev supervisor sets it to pick up edits in its own long-lived process.
   *
   * @default
   * false
   */
  fresh?: boolean;
}

/**
 * Generates the role tables from every layer's roles directory.
 *
 * Emits `shared/roles.ts`, the pure name table: `GeneratedRoles` and the `GeneratedRoleName` union.
 * It is import-free, so both type programs load it; with no roles the union falls back to `string`.
 * Emits `node/roles.ts`, which extends `KnownRoles` from it and registers each role into `useRoles`.
 * Each role is statically imported from its source file by relative path.
 *
 * Roles are read from each layer's `Config.dirs.roles` directory and combined.
 * Layers come from the registered stack, so `loadLayers` must have run first.
 * A closer layer overrides an earlier role with the same name.
 * Names in `Config.disable.roles` drop before emission.
 *
 * The app root is the nearest `package.json` above `from` (default `process.cwd()`).
 * Output lands in the `shared` and `node` buckets of the app's `dirs.codegen` (default `.ohne`).
 *
 * A file is rewritten only when its contents change.
 * Returns the absolute paths written, or `null` when no `package.json` is found.
 */
export async function generateRoles(
  from: string = process.cwd(),
  options: GenerateRolesOptions = {},
): Promise<string[] | null> {
  const sharedDir = await codegenBucket(from, 'shared');
  const nodeDir = await codegenBucket(from, 'node');
  if (isNull(sharedDir) || isNull(nodeDir)) return null;

  const { fresh = false } = options;
  const roles = await collectRoles(stackedLayers(), {
    disable: useConfig().disable.roles,
    fresh,
  });

  const shared = createCodeBuilder();
  if (roles.length === 0) {
    shared.line('export interface GeneratedRoles {}');
  } else {
    shared.line('export interface GeneratedRoles {');
    shared.indent(() => {
      roles.forEach((role) => shared.line(`${propertyKey(role.name)}: true;`));
    });
    shared.line('}');
  }
  shared.line();
  shared.line(
    'export type GeneratedRoleName = [keyof GeneratedRoles] extends [never] ? string : keyof GeneratedRoles;',
  );

  const code = createCodeBuilder();
  code.line("import type { GeneratedRoles } from '../shared/roles.ts';");
  if (roles.length > 0) code.line("import { useRoles } from 'ohne';");
  roles.forEach((role, index) => {
    code.line(`import r${index} from ${literalString(importSpecifier(nodeDir, role.file))};`);
  });
  code.line();

  code.line("declare module 'ohne' {");
  code.indent(() => {
    code.line('interface KnownRoles extends GeneratedRoles {}');
  });
  code.line('}');

  if (roles.length > 0) {
    code.line();
    code.line('const roles = useRoles();');
    roles.forEach((role, index) => {
      const name = literalString(role.name);
      code.line(`roles.register(${name}, { name: ${name}, role: r${index} });`);
    });
  }

  const sharedGen = createCodeGenerator({ dir: sharedDir, banner: BANNER });
  await sharedGen.write('roles.ts', shared.toString());
  const nodeGen = createCodeGenerator({ dir: nodeDir, banner: BANNER });
  await nodeGen.write('roles.ts', code.toString());
  return [sharedGen.path('roles.ts'), nodeGen.path('roles.ts')];
}
