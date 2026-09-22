import { queryUntyped, useDatabase } from 'ohnejs';

import type { UploadRecord } from './types.ts';

import { ensureFolders } from './_folders.ts';
import { decorated } from './_row.ts';
import { canonicalDirectory, canonicalName } from './path.ts';

/**
 * What `createFolder` takes: where the folder goes.
 */
export interface CreateFolderInput {
  /**
   * The parent path, canonicalized before use; `''` is the root.
   */
  directory: string;

  /**
   * The folder name, canonicalized before use.
   */
  name: string;

  /**
   * The `UUID` of the creating user, `null` when there is none.
   */
  author?: string | null;
}

/**
 * Creates a folder row, and the rows of every ancestor it implies, in one transaction.
 * A folder inside a private one is born private, as are the ancestors it implies.
 * A folder holds no bytes, so storage is untouched.
 * A name already taken in the directory is a `422`.
 *
 * @example
 * ```ts
 * const folder = await createFolder({ directory: 'photos', name: '2024' })
 * folder.path // -> 'photos/2024'
 * ```
 */
export async function createFolder(input: CreateFolderInput): Promise<UploadRecord> {
  const directory = canonicalDirectory(input.directory);
  const name = canonicalName(input.name);
  const author = input.author ?? null;
  const record = await useDatabase().transaction(async (tx) => {
    const locked = await ensureFolders(tx, directory, author);
    return queryUntyped('Uploads')
      .use(tx)
      .createOrThrow({ kind: 'folder', directory, name, author, private: locked });
  }, 'immediate');
  return decorated(record);
}
