import { writeFile } from './write-file.ts';

/**
 * Options for `writeJSON`.
 */
export interface WriteJSONOptions {
  /**
   * Indentation for pretty-printing.
   * Pass `0` for a compact single-line file.
   *
   * @default
   * 2
   */
  indent?: number;
}

/**
 * Serializes `value` to JSON and writes it to `path` atomically.
 *
 * Pretty-printed by default.
 * Parent directory is created if missing.
 *
 * @example
 * ```ts
 * await writeJSON('./config.json', { port: 3000 })
 * await writeJSON('./compact.json', { a: 1 }, { indent: 0 })
 * ```
 */
export async function writeJSON(
  path: string,
  value: unknown,
  options: WriteJSONOptions = {},
): Promise<void> {
  const { indent = 2 } = options;
  await writeFile(path, JSON.stringify(value, null, indent));
}
