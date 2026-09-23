import type { Transaction } from 'ohnejs';

import { queryUntyped, useDatabase } from 'ohnejs';
import { extname, isBoolean, isUndefined, omit } from 'ohnejs/utils';

import type { QueryRecord } from '../../ohne/query/read/find.ts';
import type { UploadReach } from './_reader.ts';
import type { MoveUploadTarget } from './move-upload.ts';
import type { UploadRecord } from './types.ts';
import type { UpdateUploadInput } from './update-upload.ts';

import { drainJournal, journalStorage } from '../storage/journal.ts';
import { uploadsError } from './_errors.ts';
import { ensureFolders, folderLocked } from './_folders.ts';
import { privateUploads } from './_private.ts';
import { assertReached, assertUploadReach, reachedSubtree } from './_reader.ts';
import { decorated, readUpload } from './_row.ts';
import { moveDescendants, setDescendantsPrivate } from './_subtree.ts';
import { canonicalDirectory, canonicalName, uploadPath } from './path.ts';

/**
 * Moves the row `uuid` on `tx`, as `moveUpload` describes.
 * `lock` decides whether a move into a private folder locks.
 * Resolves the moved row and the `UUID`s of the folder rows the move created.
 */
export async function moveRow(
  tx: Transaction,
  uuid: string,
  to: MoveUploadTarget,
  lock: boolean,
): Promise<{ record: Record<string, unknown>; created: string[] }> {
  const row = await readUpload(uuid, tx);
  const target = {
    directory: isUndefined(to.directory) ? row.directory : canonicalDirectory(to.directory),
    name: isUndefined(to.name) ? row.name : canonicalName(to.name),
  };
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

  const { locked, created } = await ensureFolders(tx, target.directory, row.author);
  const locks = lock && locked && target.directory !== row.directory && !row.private;
  const [moved] = await queryUntyped('Uploads')
    .use(tx)
    .where({ UUID: uuid })
    .updateOrThrow(locks ? { ...target, private: true } : target);
  if (row.kind === 'folder') {
    await moveDescendants(tx, from, path);
    if (locks) await setDescendantsPrivate(tx, path, true);
  }
  if (locks) await journalStorage(tx, { op: 'lock', from });
  await journalStorage(tx, { op: 'move', from, to: path });
  return { record: moved, created };
}

/**
 * Updates the metadata of the row `uuid` on `tx`, as `updateUpload` describes, at `locale` when given.
 */
export async function updateRow(
  tx: Transaction,
  uuid: string,
  input: UpdateUploadInput,
  locale?: string,
): Promise<QueryRecord> {
  const locks = isBoolean(input.private) && privateUploads();
  const row = await readUpload(uuid, tx);
  if (locks && input.private === false && (await folderLocked(tx, row.directory))) {
    throw uploadsError('private', 'insidePrivateFolder', { folder: row.directory });
  }
  const builder = queryUntyped('Uploads').use(tx).where({ UUID: uuid });
  const changes = locks || !isBoolean(input.private) ? input : omit(input, ['private']);
  const [updated] = await (isUndefined(locale) ? builder : builder.locale(locale)).updateOrThrow({
    ...changes,
  });
  if (!locks || input.private === (row.private === true)) return updated;
  const path = uploadPath(row);
  if (row.kind === 'folder') await setDescendantsPrivate(tx, path, input.private === true);
  await journalStorage(tx, { op: input.private ? 'lock' : 'unlock', from: path });
  return updated;
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
