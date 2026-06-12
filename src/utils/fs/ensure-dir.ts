import { mkdir } from 'node:fs/promises';

/**
 * Ensures the directory at `path` exists, creating it and any missing parents.
 *
 * Idempotent: a no-op if the directory already exists.
 *
 * @example
 * ```ts
 * await ensureDir('./build/cache') // creates ./build and ./build/cache if missing
 * ```
 */
export async function ensureDir(path: string): Promise<void> {
  await mkdir(path, { recursive: true });
}
