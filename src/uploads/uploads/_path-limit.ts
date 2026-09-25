import { uploadsError } from './_errors.ts';

// S3 keys and macOS paths stop at 1024 bytes; the rest is room for a key prefix or the `fs` root.
const MAX_PATH_BYTES = 768;

/**
 * Refuses a canonical path longer than 768 bytes as a `422` at `directory`.
 * Canonical paths are ASCII, so its length counts bytes.
 * Storage cannot place a longer object, so its journal entry would hold every overlapping one forever.
 */
export function assertPathFits(path: string): void {
  if (path.length > MAX_PATH_BYTES) {
    throw uploadsError('directory', 'pathTooLong', { max: MAX_PATH_BYTES });
  }
}
