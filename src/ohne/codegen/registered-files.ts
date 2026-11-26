import { realpath } from 'node:fs/promises';

import { literalString } from '../../utils/codegen/index.ts';
import { ensureDir } from '../../utils/fs/index.ts';
import { normalizePath, relativePath } from '../../utils/index.ts';

/**
 * Maps a source file to the expression a generated module in `dir` registers as its `file`.
 * It resolves a path relative to the module at load, so a build that moves keeps valid paths.
 * Node loads the module through its real path, so the relative path starts from the real path of `dir`.
 */
export async function registeredFiles(dir: string): Promise<(file: string) => string> {
  await ensureDir(dir);
  const real = normalizePath(await realpath(dir));
  return (file) => `resolvePath(${literalString(relativePath(real, file))}, import.meta.dirname)`;
}
