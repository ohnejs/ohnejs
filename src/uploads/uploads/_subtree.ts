import type { SQLValue, Transaction } from 'ohnejs';

import { queryMetadata, useDialect } from 'ohnejs';

import type { UploadLocation } from './path.ts';

import { escapeLike } from '../../ohne/query/sql/escape-like.ts';
import { uploadPath } from './path.ts';

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
 * The path of the longest row under a folder, `undefined` when it holds none.
 * It reads past any app scope, since every row under the folder moves with it.
 */
export async function longestPathUnder(tx: Transaction, path: string): Promise<string | undefined> {
  const dialect = useDialect();
  const meta = queryMetadata('Uploads');
  const { directory, where, params } = underFolder(path);
  const name = dialect.quote(meta.fields.name.column as string);
  const row = await tx.queryOne<UploadLocation>(
    `SELECT ${directory} AS ${dialect.quote('directory')}, ${name} AS ${dialect.quote('name')} ` +
      `FROM ${dialect.quote(meta.table)} WHERE ${where} ` +
      `ORDER BY LENGTH(${directory}) + LENGTH(${name}) DESC LIMIT 1`,
    params,
  );
  return row && uploadPath(row);
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
  const under = underFolder(path);
  const columns = {
    directory: under.directory,
    private: dialect.quote(meta.fields.private.column as string),
  };
  await tx.run(
    `UPDATE ${dialect.quote(meta.table)} SET ${assign(columns)}, ${dialect.quote('_updatedAt')} = ? ` +
      `WHERE ${under.where}`,
    [...params, Date.now(), ...under.params],
  );
}

/**
 * The quoted `directory` column and the `WHERE` clause over a folder's direct children and everything deeper.
 * `params` bind the clause's placeholders in order.
 */
function underFolder(path: string): { directory: string; where: string; params: SQLValue[] } {
  const dialect = useDialect();
  const directory = dialect.quote(queryMetadata('Uploads').fields.directory.column as string);
  return {
    directory,
    where: `${directory} = ? OR ${dialect.textMatch(directory)}`,
    params: [path, `${escapeLike(path)}/%`],
  };
}
