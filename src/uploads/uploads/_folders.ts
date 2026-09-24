import type { Transaction } from 'ohnejs';

import { queryUntyped } from 'ohnejs';
import { isBoolean, isUndefined } from 'ohnejs/utils';

import { validationError } from '../../ohne/query/write/errors.ts';
import { isNotUnique } from './_errors.ts';
import { ancestorDirectories, splitUploadPath } from './path.ts';

/**
 * Creates the folder row for `directory` and for every ancestor it implies, on `tx`.
 * A row already there is left alone; a concurrent create losing the unique race is fine too.
 * Walking shallowest first, a missing folder is born as private as the nearest one above it.
 * Resolves whether the deepest folder is private, so what lands inside it can inherit; the root never is.
 * Resolves too the `UUID`s of the folder rows this call created.
 */
export async function ensureFolders(
  tx: Transaction,
  directory: string,
  author: string | null,
): Promise<{ locked: boolean; created: string[] }> {
  const created: string[] = [];
  let locked = false;
  for (const path of ancestorDirectories(directory)) {
    const location = splitUploadPath(path);
    const row = await queryUntyped('Uploads')
      .use(tx)
      .where({ ...location })
      .findFirst();
    if (!isUndefined(row)) {
      locked = isBoolean(row.private) && row.private;
      continue;
    }
    const outcome = await queryUntyped('Uploads')
      .use(tx)
      .create({ kind: 'folder', ...location, author, private: locked });
    if (outcome.ok) created.push(outcome.record.UUID as string);
    else if (!isNotUnique(outcome.errors)) throw validationError(outcome.errors);
  }
  return { locked, created };
}

/**
 * Whether the folder at `directory` is private, read on `tx`.
 * The root never is.
 */
export async function folderLocked(tx: Transaction, directory: string): Promise<boolean> {
  if (directory === '') return false;
  const folder = await queryUntyped('Uploads')
    .use(tx)
    .where({ ...splitUploadPath(directory) })
    .findFirst();
  return folder?.private === true;
}
