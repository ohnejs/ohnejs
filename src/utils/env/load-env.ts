import { readFile } from '../fs/read-file.ts';
import { isNull } from '../is/is-null.ts';
import { parseEnv } from './parse-env.ts';

/**
 * Reads a `.env` file from disk and parses it into a flat record of strings.
 *
 * `path` is resolved relative to the current working directory.
 * Returns `{}` if the file does not exist.
 * Any other read error propagates, as do parse errors from a malformed file.
 * See `parseEnv` for the grammar.
 *
 * @example
 * ```ts
 * await loadEnv()             // reads ./.env, returns {} if missing
 * await loadEnv('.env.local') // reads ./.env.local
 * ```
 */
export async function loadEnv(path: string = '.env'): Promise<Record<string, string>> {
  const text = await readFile(path);
  if (isNull(text)) return {};
  return parseEnv(text);
}
