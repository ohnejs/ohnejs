import type { Transaction } from 'ohnejs';

import { queryUntyped, useDatabase } from 'ohnejs';
import { extname, isBoolean, isUndefined, omit } from 'ohnejs/utils';

import type { QueryRecord } from '../../ohne/query/read/find.ts';
import type { UploadReach } from './_reach.ts';
import type { UploadRow } from './_row.ts';
import type { MoveUploadTarget } from './move-upload.ts';
import type { UploadRecord } from './types.ts';
import type { UpdateUploadInput } from './update-upload.ts';

import { notFound } from '../../ohne/http/http-error.ts';
import { drainJournal, journalStorage } from '../storage/journal.ts';
import { uploadsError } from './_errors.ts';
import { ensureFolders, folderLocked } from './_folders.ts';
import { assertPathFits } from './_path-limit.ts';
import { assertReached, assertUploadReach, reachedSubtree } from './_reach.ts';
import { decorated, readUpload } from './_row.ts';
import { longestPathUnder, moveDescendants, setDescendantsPrivate } from './_subtree.ts';
import { canonicalDirectory, canonicalName, uploadPath } from './path.ts';

/**
 * Moves the row `uuid` on `tx`, as `moveUpload` describes.
 * `lock` decides whether a move into a private folder locks.
 * A path past 768 bytes, or one a lengthened folder's deepest row would reach, is a `422` at `directory`.
 * Resolves the moved row and the `UUID`s of the folder rows the move created.
 * A write that reaches no row is a `404`, so the object never moves without its row.
 * Only the columns the move changes are written, and the object follows the row as written.
 * So a row stored before names were capped keeps its object.
 */
export async function moveRow(
  tx: Transaction,
  uuid: string,
  to: MoveUploadTarget,
  lock: boolean,
): Promise<{ record: Record<string, unknown>; created: string[] }> {
  const row = await readUpload(uuid, tx);
  const changes: { directory?: string; name?: string } = {};
  if (!isUndefined(to.directory)) changes.directory = canonicalDirectory(to.directory);
  if (!isUndefined(to.name)) changes.name = canonicalName(to.name);
  const target = { directory: row.directory, name: row.name, ...changes };
  if (target.directory === row.directory && target.name === row.name) {
    return { record: row, created: [] };
  }

  const from = uploadPath(row);
  const path = uploadPath(target);
  if (row.kind === 'file') {
    if (extname(row.name) !== extname(target.name)) throw uploadsError('name', 'extensionChange');
  } else if (target.directory === from || target.directory.startsWith(`${from}/`)) {
    throw uploadsError('directory', 'folderIntoItself');
  }
  const grows = row.kind === 'folder' && path.length > from.length;
  const deepest = grows ? await longestPathUnder(tx, from) : undefined;
  assertPathFits(path + (deepest?.slice(from.length) ?? ''));

  const { locked, created } = await ensureFolders(tx, target.directory, row.author);
  const locks = lock && locked && target.directory !== row.directory && !row.private;
  const [moved] = await queryUntyped('Uploads')
    .use(tx)
    .where({ UUID: uuid })
    .updateOrThrow(locks ? { ...changes, private: true } : changes);
  if (isUndefined(moved)) throw notFound();
  const landed = uploadPath(moved as UploadRow);
  if (row.kind === 'folder') {
    await moveDescendants(tx, from, landed);
    if (locks) await setDescendantsPrivate(tx, landed, true);
  }
  if (locks) await journalStorage(tx, { op: 'lock', from });
  await journalStorage(tx, { op: 'move', from, to: landed });
  return { record: moved, created };
}

/**
 * Updates the metadata of the row `uuid` on `tx`, as `updateUpload` describes, at `locale` when given.
 * A write that reaches no row is a `404`, so the object is never locked or unlocked without its row.
 */
export async function updateRow(
  tx: Transaction,
  uuid: string,
  input: UpdateUploadInput,
  locale?: string,
): Promise<QueryRecord> {
  const locks = isBoolean(input.private);
  const row = await readUpload(uuid, tx);
  if (locks && input.private === false && (await folderLocked(tx, row.directory))) {
    throw uploadsError('private', 'insidePrivateFolder', { folder: row.directory });
  }
  const builder = queryUntyped('Uploads').use(tx).where({ UUID: uuid });
  const changes = locks || !isBoolean(input.private) ? input : omit(input, ['private']);
  const [updated] = await (isUndefined(locale) ? builder : builder.locale(locale)).updateOrThrow({
    ...changes,
  });
  if (isUndefined(updated)) throw notFound();
  if (!locks || input.private === (row.private === true)) return updated;
  const path = uploadPath(row);
  if (row.kind === 'folder') await setDescendantsPrivate(tx, path, input.private === true);
  await journalStorage(tx, { op: input.private ? 'lock' : 'unlock', from: path });
  return updated;
}

/**
 * Deletes `row` on `tx`, as `deleteUpload` describes: a folder takes its whole subtree along.
 * A delete that reaches no row is a `404`, so the object never goes without its row.
 * The subtree follows the folder past any app scope, since its objects go with the folder's prefix.
 */
export async function deleteRow(tx: Transaction, row: UploadRow): Promise<void> {
  const path = uploadPath(row);
  const { deleted } = await queryUntyped('Uploads').use(tx).where({ UUID: row.UUID }).delete();
  if (deleted === 0) throw notFound();
  if (row.kind === 'folder') {
    await queryUntyped('Uploads')
      .use(tx)
      .unscoped()
      .whereAny((g) => [
        g.where({ directory: path }),
        g.where({ directory: { startsWith: `${path}/` } }),
      ])
      .delete();
  }
  await journalStorage(tx, { op: 'delete', from: path });
}

/**
 * Moves the row `uuid` to `target` and applies `changes`, in one transaction.
 * An explicit `private` among `changes` is applied after the move, so the move itself never locks.
 * With `reach`, a row it hides is a `404`.
 * After the write, it must still admit that row, every row below it that matched, and every folder created.
 * Otherwise the write is a `422` and rolls back.
 */
export async function patchUpload(
  uuid: string,
  { target, changes }: { target?: MoveUploadTarget; changes?: UpdateUploadInput },
  { locale, reach }: { locale?: string; reach?: UploadReach } = {},
): Promise<UploadRecord> {
  const record = await useDatabase().transaction(async (tx) => {
    if (!isUndefined(reach)) await assertUploadReach(uuid, reach, tx);
    const row = await readUpload(uuid, tx);
    const below = row.kind === 'folder' ? await reachedSubtree(tx, reach, uploadPath(row)) : [];
    let record: Record<string, unknown> = row;
    let created: string[] = [];
    if (!isUndefined(target)) {
      ({ record, created } = await moveRow(tx, uuid, target, isUndefined(changes?.private)));
    }
    if (!isUndefined(changes)) record = await updateRow(tx, uuid, changes, locale);
    await assertReached(tx, reach, [uuid, ...below, ...created]);
    return record;
  }, 'immediate');
  await drainJournal();
  return decorated(record);
}
