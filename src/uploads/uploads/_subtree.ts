import type { SQLValue, Transaction } from 'ohnejs';

import { queryMetadata, useDialect } from 'ohnejs';

import { escapeLike } from '../../ohne/query/sql/escape-like.ts';

/**
 * The quoted columns a subtree statement assigns to.
 */
interface SubtreeColumns {
  directory: string;
  private: string;
}

/**
 * Rewrites the `directory` of every row under a folder from its old path to its new one, in one statement.
 */
export async function moveDescendants(tx: Transaction, from: string, to: string): Promise<void> {
  await updateSubtree(tx, from, ({ directory }) => `${directory} = ? || substr(${directory}, ?)`, [
    to,
    from.length + 1,
  ]);
}

/**
 * Sets `private` on every row under a folder, in one statement.
 */
export async function setDescendantsPrivate(
  tx: Transaction,
  path: string,
  value: boolean,
): Promise<void> {
  await updateSubtree(tx, path, (columns) => `${columns.private} = ?`, [value ? 1 : 0]);
}

/**
 * Runs one `UPDATE` over a folder's direct children and everything deeper, bumping `_updatedAt` with it.
 * `assign` builds the `SET` clause from the quoted columns, and `params` bind its placeholders in order.
 */
async function updateSubtree(
  tx: Transaction,
  path: string,
  assign: (columns: SubtreeColumns) => string,
  params: SQLValue[],
): Promise<void> {
  const dialect = useDialect();
  const meta = queryMetadata('Uploads');
  const directory = dialect.quote(meta.fields.directory.column as string);
  const columns = { directory, private: dialect.quote(meta.fields.private.column as string) };
  await tx.run(
    `UPDATE ${dialect.quote(meta.table)} SET ${assign(columns)}, ${dialect.quote('_updatedAt')} = ? ` +
      `WHERE ${directory} = ? OR ${dialect.textMatch(directory)}`,
    [...params, Date.now(), path, `${escapeLike(path)}/%`],
  );
}
