import { stat } from 'node:fs/promises';

import { dirname } from '../path/dirname.ts';
import { extname } from '../path/extname.ts';
import { joinPath } from '../path/join-path.ts';
import { resolvePath } from '../path/resolve-path.ts';

const SOURCE_EXTS = ['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs', '.json'];

const JS_TO_TS: Record<string, string> = {
  '.js': '.ts',
  '.jsx': '.tsx',
  '.mjs': '.mts',
  '.cjs': '.cts',
};

/**
 * Resolves a relative import specifier to the absolute project file it names, or `null`.
 *
 * Only relative specifiers (`./`, `../`) resolve.
 * Bare and external specifiers (`ohne`, `node:fs`, `@scope/pkg`) return `null`, never under `node_modules`.
 * Resolution probes the filesystem like the TypeScript and Node resolvers.
 * It tries an explicit extension first, then source extensions, then an `index` file for a directory.
 * A `.js`-family specifier prefers its TypeScript sibling, so `./x.js` resolves to `./x.ts` when it exists.
 *
 * @example
 * ```ts
 * await resolveImport('/app/a.ts', './b')     // -> '/app/b.ts'
 * await resolveImport('/app/a.ts', './dir')   // -> '/app/dir/index.ts'
 * await resolveImport('/app/a.ts', 'node:fs') // -> null
 * ```
 */
export async function resolveImport(fromFile: string, specifier: string): Promise<string | null> {
  if (!isRelativeSpecifier(specifier)) return null;

  const target = resolvePath(specifier, dirname(fromFile));
  for (const candidate of [...fileCandidates(target), ...indexCandidates(target)]) {
    if (await isFile(candidate)) return candidate;
  }
  return null;
}

function isRelativeSpecifier(specifier: string): boolean {
  return (
    specifier === '.' ||
    specifier === '..' ||
    specifier.startsWith('./') ||
    specifier.startsWith('../')
  );
}

function fileCandidates(target: string): string[] {
  const ext = extname(target);
  if (ext === '') return [target, ...SOURCE_EXTS.map((e) => `${target}${e}`)];

  const tsSibling = JS_TO_TS[ext];
  if (!tsSibling) return [target];
  return [`${target.slice(0, -ext.length)}${tsSibling}`, target];
}

function indexCandidates(target: string): string[] {
  return SOURCE_EXTS.map((e) => joinPath(target, `index${e}`));
}

async function isFile(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile();
  } catch {
    return false;
  }
}
