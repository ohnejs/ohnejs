import { queryUntyped, useDatabase } from 'ohnejs';

import type { UploadReach } from './_reach.ts';
import type { UploadRecord } from './types.ts';

import { ensureFolders } from './_folders.ts';
import { assertPathFits } from './_path-limit.ts';
import { assertReached } from './_reach.ts';
import { decorated } from './_row.ts';
import { canonicalDirectory, canonicalFolderName, uploadPath } from './path.ts';

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

  /**
   * The read scope every row this write touches or creates must stay inside; omitted writes unscoped.
   */
  reach?: UploadReach;
}

/**
 * Creates a folder row, and the rows of every ancestor it implies, in one transaction.
 * A folder inside a private one is born private, as are the ancestors it implies.
 * A folder holds no bytes, so storage is untouched.
 * A name already taken in the directory is a `422`, and so is a path past 768 bytes, at `directory`.
 *
 * @example
 * ```ts
 * const folder = await createFolder({ directory: 'photos', name: '2024' })
 * folder.path // -> 'photos/2024'
 * ```
 */
export async function createFolder(input: CreateFolderInput): Promise<UploadRecord> {
  const directory = canonicalDirectory(input.directory);
  const name = canonicalFolderName(input.name);
  const author = input.author ?? null;
  assertPathFits(uploadPath({ directory, name }));
  const record = await useDatabase().transaction(async (tx) => {
    const { locked, created } = await ensureFolders(tx, directory, author);
    const folder = await queryUntyped('Uploads')
      .use(tx)
      .createOrThrow({ kind: 'folder', directory, name, author, private: locked });
    await assertReached(tx, input.reach, [folder.UUID as string, ...created]);
    return folder;
  }, 'immediate');
  return decorated(record);
}
