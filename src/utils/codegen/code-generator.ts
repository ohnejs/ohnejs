import { listDir } from '../fs/list-dir.ts';
import { removeFile } from '../fs/remove-file.ts';
import { writeFileIfChanged } from '../fs/write-file-if-changed.ts';
import { isNull } from '../is/is-null.ts';
import { isUndefined } from '../is/is-undefined.ts';
import { joinPath } from '../path/join-path.ts';
import { relativePath as toRelative } from '../path/relative-path.ts';
import { resolvePath } from '../path/resolve-path.ts';

/**
 * Options for `createCodeGenerator`.
 */
export interface CodeGeneratorOptions {
  /**
   * Output directory every path is resolved against.
   * Resolved against `process.cwd()` when relative.
   */
  dir: string;

  /**
   * Text prepended to every written file, followed by a newline.
   * Use it to mark output as generated, e.g. `'// Generated. Do not edit.'`.
   * Omitted prepends nothing.
   */
  banner?: string;
}

/**
 * A directory-scoped code generator returned by `createCodeGenerator`.
 */
export interface CodeGenerator {
  /**
   * The resolved, absolute output directory.
   */
  readonly dir: string;

  /**
   * Resolves `relativePath` against the output directory and returns the absolute path.
   */
  path(relativePath: string): string;

  /**
   * Writes `content` to `relativePath`, prepending the banner if one is set.
   * Skips the write when the file is already up to date.
   * Records the path so a later `prune` keeps it.
   * Returns `true` if a write happened, `false` if it was unchanged.
   */
  write(relativePath: string, content: string): Promise<boolean>;

  /**
   * Returns the relative path of every file written so far, in write order.
   */
  written(): string[];

  /**
   * Deletes every non-hidden file under the output directory that was not written this run.
   * Leaves hidden entries and directories in place.
   * Returns the relative paths that were removed.
   */
  prune(): Promise<string[]>;
}

/**
 * Creates a directory-scoped generator for robust, repeatable code generation.
 *
 * Each run writes the full set of files, then `prune` removes anything left from a previous run.
 * Output stays deterministic, and unchanged files are never rewritten so watchers stay quiet.
 *
 * @example
 * ```ts
 * const gen = createCodeGenerator({
 *   dir: '.gen',
 *   banner: '// Generated. Do not edit.',
 * })
 *
 * await gen.write('imports.ts', imports) // -> true on first run, false when unchanged
 * await gen.write('types.d.ts', types)
 *
 * await gen.prune() // -> ['stale.ts'] removes files this run did not write
 * ```
 */
export function createCodeGenerator(options: CodeGeneratorOptions): CodeGenerator {
  const { dir, banner } = options;
  const root = resolvePath(dir);
  const written = new Set<string>();

  const generator: CodeGenerator = {
    dir: root,

    path(relativePath) {
      return joinPath(root, relativePath);
    },

    write(relativePath, content) {
      const target = joinPath(root, relativePath);
      written.add(toRelative(root, target));
      const body = isUndefined(banner) ? content : `${banner}\n${content}`;
      return writeFileIfChanged(target, body);
    },

    written() {
      return [...written];
    },

    async prune() {
      const entries = await listDir(root, { files: true, dirs: false });
      if (isNull(entries)) return [];
      const removed: string[] = [];
      for (const entry of entries) {
        if (!written.has(entry.relativePath)) {
          await removeFile(entry.path);
          removed.push(entry.relativePath);
        }
      }
      return removed;
    },
  };

  return generator;
}
