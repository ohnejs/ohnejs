import { extname } from './extname.ts';

/**
 * The extensions of a TypeScript module Node strips and runs, each with its leading dot.
 */
export const TYPESCRIPT_EXTENSIONS = ['.ts', '.mts'];

/**
 * Whether `path` names a TypeScript module Node strips and runs: a `.ts` or `.mts` file.
 *
 * @example
 * ```ts
 * isTypeScriptPath('pages/home.ts') // -> true
 * isTypeScriptPath('boot.mts')      // -> true
 * isTypeScriptPath('font.woff2')    // -> false
 * isTypeScriptPath('ts')            // -> false
 * ```
 */
export function isTypeScriptPath(path: string): boolean {
  return TYPESCRIPT_EXTENSIONS.includes(extname(path));
}
