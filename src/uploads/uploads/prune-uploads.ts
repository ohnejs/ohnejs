import type { CollectionQueryMeta, Transaction } from 'ohnejs';

import { ohneError, queryMetadata, useDatabase, useDialect } from 'ohnejs';
import { isPathInside, isUndefined, normalizePath } from 'ohnejs/utils';

import type { UploadLocation } from './path.ts';

import { useUploadsConfig } from '../config.ts';
import { drainJournal, journalStorage } from '../storage/journal.ts';
import { useStorage } from '../storage/use-storages.ts';
import { ancestorDirectories, TEMP_PREFIX, uploadPath } from './path.ts';

/**
 * Options for `pruneUploads`.
 */
export interface PruneUploadsOptions {
  /**
   * Whether to delete the stored objects no row names, not only list them.
   *
   * @default
   * false
   */
  delete?: boolean;
}

/**
 * Finds the stored objects no `Uploads` row names, and deletes them with `delete`.
 *
 * The journal drains first, so every object sits where its row says.
 * Storage is listed before the rows are read, so a file uploaded meanwhile is never taken for an orphan.
 * Staged uploads under `.tmp/` are left to `sweepStaged`.
 * A path a pending `move` touches is left to the next drain.
 * A path under a pending `delete` is still listed, so a delete that keeps failing is never hidden.
 * A folder above a named file is never an orphan, since deleting it would take that file along.
 * Paths compare without case, so a file under a folder spelled in capitals still counts as named.
 * Rows are read past every read hook, so a row an app hides or drops still keeps its bytes.
 * A key no row could ever name, like one with a `..` or empty segment, is left alone.
 * With `delete`, each orphan is checked again and journaled as a `delete` in one transaction.
 * So an upload racing the prune lands after the delete, never under it.
 * An orphan a pending `delete` already covers is not journaled twice.
 * A storage backend without `list` cannot be pruned, so the call throws.
 * Resolves the orphaned paths, sorted.
 *
 * @example
 * ```ts
 * await pruneUploads()                 // -> ['imports/stray.pdf']
 * await pruneUploads({ delete: true }) // -> ['imports/stray.pdf']
 * ```
 */
export async function pruneUploads(options: PruneUploadsOptions = {}): Promise<string[]> {
  const storage = useStorage();
  if (isUndefined(storage.list)) {
    throw ohneError({
      title: `The \`${useUploadsConfig().storage}\` storage cannot list its objects`,
      body: ['Stray files are found by listing the stored objects, so the backend needs `list`.'],
    });
  }
  await drainJournal();
  const stored: string[] = [];
  for await (const path of storage.list()) {
    if (nameable(path)) stored.push(path);
  }
  if (options.delete !== true) return (await orphans(stored)).strays;
  const deleted = await useDatabase().transaction(async (tx) => {
    const { strays, fresh } = await orphans(stored, tx);
    for (const from of fresh) await journalStorage(tx, { op: 'delete', from });
    return strays;
  }, 'immediate');
  await drainJournal();
  return deleted;
}

/**
 * Whether a row could ever name the stored key: a normalized relative path outside `.tmp/`.
 */
function nameable(path: string): boolean {
  return (
    path !== '.' &&
    normalizePath(path) === path &&
    isPathInside(path, '') &&
    !isPathInside(path, TEMP_PREFIX)
  );
}

/**
 * The paths of `stored` no file row names or lies above, as sorted `strays`.
 * A path a pending `move` shares is left out, since that move may still carry it.
 * `fresh` keeps the strays no pending `delete` covers yet.
 * On a transaction both reads happen inside it.
 */
async function orphans(
  stored: readonly string[],
  db: Transaction = useDatabase(),
): Promise<{ strays: string[]; fresh: string[] }> {
  const dialect = useDialect();
  const [uploads, journal] = [queryMetadata('Uploads'), queryMetadata('UploadsJournal')];
  const column = (meta: CollectionQueryMeta, field: string) =>
    dialect.quote(meta.fields[field].column as string);
  const select = (meta: CollectionQueryMeta, ...fields: string[]) =>
    fields.map((field) => `${column(meta, field)} AS ${dialect.quote(field)}`).join(', ');
  const files = await db.query<UploadLocation>(
    `SELECT ${select(uploads, 'directory', 'name')} FROM ${dialect.quote(uploads.table)} ` +
      `WHERE ${column(uploads, 'kind')} = ?`,
    ['file'],
  );
  const entries = await db.query<{ op: 'move' | 'delete'; from: string; to: string | null }>(
    `SELECT ${select(journal, 'op', 'from', 'to')} FROM ${dialect.quote(journal.table)} ` +
      `WHERE ${column(journal, 'op')} IN (?, ?)`,
    ['move', 'delete'],
  );
  const named = new Set(
    files.flatMap((row) => [uploadPath(row), ...ancestorDirectories(row.directory)]),
  );
  const moving = entries.flatMap(({ op, from, to }) =>
    op === 'move' ? [from, to as string].map((path) => path.toLowerCase()) : [],
  );
  const deleting = entries.flatMap(({ op, from }) => (op === 'delete' ? [from] : []));
  const touched = (path: string) => {
    const lower = path.toLowerCase();
    return moving.some((other) => isPathInside(lower, other) || isPathInside(other, lower));
  };
  const strays = stored.filter((path) => !named.has(path.toLowerCase()) && !touched(path)).sort();
  const fresh = strays.filter((path) => !deleting.some((other) => isPathInside(path, other)));
  return { strays, fresh };
}
