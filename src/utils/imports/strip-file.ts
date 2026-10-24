import { stripTypeScriptTypes } from 'node:module';

import { readFile } from '../fs/read-file.ts';
import { isNull } from '../is/is-null.ts';
import { silenceFirstStripWarning } from './silence-strip-warning.js';

silenceFirstStripWarning();

/**
 * Reads the TypeScript file at `path` and strips its types, the way Node does to run it.
 * Every position stays in place, so the JavaScript is as long as the source.
 *
 * Returns `null` if the file does not exist.
 * Syntax the stripper cannot erase, like an `enum`, throws its `SyntaxError`.
 *
 * @example
 * ```ts
 * await stripFile('./add.ts')     // -> 'export const add = (a        , b        ) => a + b;\n'
 * await stripFile('./missing.ts') // -> null
 * ```
 */
export async function stripFile(path: string): Promise<string | null> {
  const source = await readFile(path);
  return isNull(source) ? null : stripTypeScriptTypes(source);
}
