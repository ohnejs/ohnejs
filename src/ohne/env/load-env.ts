import { readFileSync } from 'node:fs';

import { parseEnv } from '../../utils/index.ts';

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
 * loadEnv()             // reads ./.env, returns {} if missing
 * loadEnv('.env.local') // reads ./.env.local
 * ```
 */
export function loadEnv(path: string = '.env'): Record<string, string> {
  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return {};
    throw err;
  }
  return parseEnv(text);
}
