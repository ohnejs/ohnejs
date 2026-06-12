import { isNull } from '../is/is-null.ts';
import { readFile } from './read-file.ts';

/**
 * Reads and parses a JSON file.
 *
 * Returns `null` if the file does not exist.
 * Throws on malformed JSON or any non-ENOENT read error.
 *
 * @example
 * ```ts
 * await readJSON<{ port: number }>('./config.json') // -> { port: 3000 } | null
 * ```
 */
export async function readJSON<T = unknown>(path: string): Promise<T | null> {
  const text = await readFile(path);
  if (isNull(text)) return null;
  return JSON.parse(text) as T;
}
