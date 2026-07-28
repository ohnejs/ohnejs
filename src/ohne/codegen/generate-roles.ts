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
 * Generates the role table from every layer's roles directory.
 * Emits `node/roles.ts` so importing it registers each role into `useRoles`.
 * It types `KnownRoles` with every name, so `RoleName` is the union of all of them.
 * Each role is statically imported from its source file by relative path.
 *
 * Roles are read from each layer's `Config.dirs.roles` directory and combined.
 * Layers come from the registered stack, so `loadLayers` must have run first.
 * A closer layer overrides an earlier role with the same name.
 * Names in `Config.disable.roles` drop before emission.
 *
 * The app root is the nearest `package.json` above `from` (default `process.cwd()`).
 * Output lands in the `node` bucket of the app's `dirs.codegen` (default `.ohne`).
 *
 * The file is rewritten only when its contents change.
 * Returns the absolute path written, or `null` when no `package.json` is found.
 */
export async function generateRoles(
  from: string = process.cwd(),
  options: GenerateRolesOptions = {},
): Promise<string | null> {
  const dir = await codegenBucket(from, 'node');
  if (isNull(dir)) return null;

  const { fresh = false } = options;
  const roles = await collectRoles(stackedLayers(), {
    disable: useConfig().disable.roles,
    fresh,
  });

  const code = createCodeBuilder();
  code.line(
    roles.length === 0 ? "import type {} from 'ohne';" : "import { useRoles } from 'ohne';",
  );
  roles.forEach((role, index) => {
    code.line(`import r${index} from ${literalString(importSpecifier(dir, role.file))};`);
  });
  code.line();

  code.line("declare module 'ohne' {");
  code.indent(() => {
    if (roles.length === 0) {
      code.line('interface KnownRoles {}');
      return;
    }
    code.line('interface KnownRoles {');
    code.indent(() => {
      roles.forEach((role) => code.line(`${propertyKey(role.name)}: true;`));
    });
    code.line('}');
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

  const gen = createCodeGenerator({ dir, banner: BANNER });
  await gen.write('roles.ts', code.toString());
  return gen.path('roles.ts');
}
