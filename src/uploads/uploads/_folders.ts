import type { Transaction } from 'ohne';

import { queryUntyped } from 'ohne';

import { validationError } from '../../ohne/query/write/errors.ts';
import { isNotUnique } from './_errors.ts';
import { ancestorDirectories, splitUploadPath } from './path.ts';

/**
 * Creates the folder row for `directory` and for every ancestor it implies, on `tx`.
 * A row already there is left alone; a concurrent create losing the unique race is fine too.
 */
export async function ensureFolders(
  tx: Transaction,
  directory: string,
  author: string | null,
): Promise<void> {
  for (const path of ancestorDirectories(directory)) {
    const location = splitUploadPath(path);
    if (
      await queryUntyped('Uploads')
        .use(tx)
        .where({ ...location })
        .exists()
    )
      continue;
    const outcome = await queryUntyped('Uploads')
      .use(tx)
      .create({ kind: 'folder', ...location, author });
    if (!outcome.ok && !isNotUnique(outcome.errors)) throw validationError(outcome.errors);
  }
}
