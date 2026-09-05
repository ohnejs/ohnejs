import type { Transaction } from 'ohne';

import { queryMetadata, queryUntyped, useDatabase, useDialect } from 'ohne';
import { extname, isUndefined } from 'ohne/utils';

import type { UploadRecord } from './types.ts';

import { escapeLike } from '../../ohne/query/sql/escape-like.ts';
import { drainJournal, journalStorage } from '../storage/journal.ts';
import { uploadsError } from './_errors.ts';
import { ensureFolders } from './_folders.ts';
import { decorated, readUpload } from './_row.ts';
import { canonicalDirectory, canonicalName, uploadPath } from './path.ts';

/**
 * Where `moveUpload` takes a row: each part canonicalized, each defaulting to the current value.
 */
export interface MoveUploadTarget {
  /**
   * The new parent path; omitted keeps the current one.
   */
  directory?: string;

  /**
   * The new name; omitted keeps the current one.
   * A file keeps its extension, since the extension names its immutable type.
   */
  name?: string;
}

/**
 * Renames a row, moves it to another directory, or both, moving its object along.
 *
 * One transaction creates the missing folder rows of the target, updates the row, and journals the move.
 * A folder's descendants have their `directory` rewritten by prefix in one statement.
 * The journal drains after the commit, so the object moves once the row points at its new path.
 * A file whose extension would change is a `422`; so is a folder moved into itself.
 * A target already taken is the pipeline's `422`; an unknown `UUID` a `404`.
 *
 * @example
 * ```ts
 * await moveUpload(uuid, { directory: 'photos/2024' })
 * await moveUpload(uuid, { name: 'Dusk.jpg' })
 * ```
 */
export async function moveUpload(uuid: string, to: MoveUploadTarget): Promise<UploadRecord> {
  const record = await useDatabase().transaction(async (tx) => {
    const row = await readUpload(uuid, tx);
    const target = {
      directory: isUndefined(to.directory) ? row.directory : canonicalDirectory(to.directory),
      name: isUndefined(to.name) ? row.name : canonicalName(to.name),
    };
    if (target.directory === row.directory && target.name === row.name) return row;

    const from = uploadPath(row);
    const path = uploadPath(target);
    if (row.kind === 'file') {
      if (extname(row.name) !== extname(target.name)) throw uploadsError('name', 'extensionChange');
    } else if (target.directory === from || target.directory.startsWith(`${from}/`)) {
      throw uploadsError('directory', 'folderIntoItself');
    }

    await ensureFolders(tx, target.directory, row.author);
    const [moved] = await queryUntyped('Uploads')
      .use(tx)
      .where({ UUID: uuid })
      .updateOrThrow(target);
    if (row.kind === 'folder') await moveDescendants(tx, from, path);
    await journalStorage(tx, { op: 'move', from, to: path });
    return moved;
  }, 'immediate');
  await drainJournal();
  return decorated(record);
}

/**
 * Rewrites the `directory` of every row under a folder from its old path to its new one, in one statement.
 */
async function moveDescendants(tx: Transaction, from: string, to: string): Promise<void> {
  const dialect = useDialect();
  const meta = queryMetadata('Uploads');
  const table = dialect.quote(meta.table);
  const directory = dialect.quote(meta.fields.directory.column as string);
  const updatedAt = dialect.quote('_updatedAt');
  await tx.run(
    `UPDATE ${table} SET ${directory} = ? || substr(${directory}, ?), ${updatedAt} = ? ` +
      `WHERE ${directory} = ? OR ${dialect.textMatch(directory)}`,
    [to, from.length + 1, Date.now(), from, `${escapeLike(from)}/%`],
  );
}
