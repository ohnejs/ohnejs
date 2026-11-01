import { realpath } from 'node:fs/promises';
import { isBuiltin } from 'node:module';

import { readJSON } from '../fs/read-json.ts';
import { resolveModuleDir } from '../fs/resolve-module-dir.ts';
import { stat } from '../fs/stat.ts';
import { isNull } from '../is/is-null.ts';
import { isString } from '../is/is-string.ts';
import { isUndefined } from '../is/is-undefined.ts';
import { dirname } from '../path/dirname.ts';
import { joinPath } from '../path/join-path.ts';
import { normalizePath } from '../path/normalize-path.ts';
import { resolvePath } from '../path/resolve-path.ts';
import { parsePackageSpecifier } from './parse-package-specifier.ts';
import { resolvePackageExports } from './resolve-package-exports.ts';

/**
 * Resolves a package specifier, imported by `fromFile`, to the file Node's `import` loads, or `null`.
 * The package is found as `resolveModuleDir` finds it, so workspace links and self-references apply.
 * Its `exports` map the subpath as `resolvePackageExports` does.
 * Without `exports`, a subpath names a file in the package and a bare name its `main`.
 * The result follows symlinks to the real file.
 * A builtin like `node:fs`, a package that is not installed, or a subpath it does not export returns `null`.
 *
 * @example
 * ```ts
 * await resolvePackageImport('/app/a.ts', '@acme/types/user.ts') // -> '/app/packages/types/user.ts'
 * await resolvePackageImport('/app/a.ts', 'node:fs')             // -> null
 * await resolvePackageImport('/app/a.ts', 'missing')             // -> null
 * ```
 */
export async function resolvePackageImport(
  fromFile: string,
  specifier: string,
): Promise<string | null> {
  if (isBuiltin(specifier)) return null;
  const { name, subpath } = parsePackageSpecifier(specifier);
  const root = await resolveModuleDir(name, dirname(fromFile));
  if (isNull(root)) return null;
  const manifest = await readJSON<{ exports?: unknown; main?: unknown }>(
    joinPath(root, 'package.json'),
  );
  const target = isUndefined(manifest?.exports)
    ? legacyTarget(manifest?.main, subpath)
    : resolvePackageExports(manifest.exports, subpath);
  if (isNull(target)) return null;
  const file = resolvePath(target, root);
  if (!(await stat(file))?.isFile()) return null;
  return normalizePath(await realpath(file));
}

/**
 * The file a package without `exports` maps `subpath` to: the subpath itself, or `main` for the bare name.
 */
function legacyTarget(main: unknown, subpath: string): string {
  if (subpath !== '.') return subpath;
  return isString(main) ? main : 'index.js';
}
