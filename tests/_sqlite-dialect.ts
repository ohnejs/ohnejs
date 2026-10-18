import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { DatabaseAdapter } from '../src/ohne/database/adapter.ts';

import { useDialects } from '../src/ohne/database/use-dialects.ts';
import { isUndefined } from '../src/utils/index.ts';

let sharedDirectory: string | undefined;

let sharedCount = 0;

/**
 * The registry's own SQLite instance, so the seam re-registers the same object.
 */
export const dialect = useDialects().get('sqlite')!;

/**
 * SQLite's private in-memory database, fresh on every connect.
 */
export const memoryURL = ':memory:';

/**
 * Returns the path of a new database file in a temporary directory removed when the process exits.
 */
export async function sharedURL(): Promise<string> {
  if (isUndefined(sharedDirectory)) {
    const directory = mkdtempSync(join(tmpdir(), 'ohne-shared-'));
    process.on('exit', () => rmSync(directory, { recursive: true, force: true }));
    sharedDirectory = directory;
  }
  return join(sharedDirectory, `${++sharedCount}.db`);
}

/**
 * Returns the error SQLite raises on a held lock.
 */
export function busyError(): unknown {
  return Object.assign(new Error('database is locked'), { errcode: 5 });
}

/**
 * Aborts every `DELETE` on `table` with `bound` through a trigger, which the returned function drops.
 */
export async function failDeletes(
  db: DatabaseAdapter,
  table: string,
): Promise<() => Promise<void>> {
  const trigger = dialect.quote(`fail_deletes_${table}`);
  await db.exec(
    `CREATE TRIGGER ${trigger} BEFORE DELETE ON ${dialect.quote(table)} BEGIN SELECT RAISE(ABORT, 'bound'); END`,
  );
  return () => db.exec(`DROP TRIGGER ${trigger}`);
}

/**
 * Links nothing, since SQLite is built in.
 */
export function linkLayers(): string[] {
  return [];
}
