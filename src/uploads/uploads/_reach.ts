import type { LocaleCode, QueryScope, Transaction, UntypedQueryBuilder } from 'ohnejs';

import { applyScope, notFound, queryUntyped } from 'ohnejs';
import { chunk, isUndefined, uniqueArray } from 'ohnejs/utils';

import { uploadsError } from './_errors.ts';

/**
 * The part of an `Uploads` read `access` scope a write must keep its rows inside.
 */
export type UploadReach = Pick<QueryScope, 'where' | 'locale'>;

/**
 * Refuses the row `uuid` with a `404` unless `reach` admits it.
 * On `tx` the check reads inside that transaction, atomic with the write it guards.
 */
export async function assertUploadReach(
  uuid: string,
  reach: UploadReach,
  tx?: Transaction,
): Promise<void> {
  if (!(await reached(reach, tx).where({ UUID: uuid }).exists())) throw notFound();
}

/**
 * Refuses the rows `uuids` with a `404` unless `reach` admits every one, as `assertUploadReach` does.
 * `uuids` must hold no duplicates.
 */
export async function assertUploadsReach(
  uuids: readonly string[],
  reach: UploadReach,
  tx?: Transaction,
): Promise<void> {
  for (const batch of chunk(uuids, 900)) {
    const count = await reached(reach, tx)
      .where({ UUID: { in: batch } })
      .count();
    if (count < batch.length) throw notFound();
  }
}

/**
 * The `UUID`s under the folder at `path` that `reach` admits, none when it has no `where`.
 */
export async function reachedSubtree(
  tx: Transaction,
  reach: UploadReach | undefined,
  path: string,
): Promise<string[]> {
  if (isUndefined(reach?.where)) return [];
  const subtree = reached(reach, tx).whereAny((g) => [
    g.where({ directory: path }),
    g.where({ directory: { startsWith: `${path}/` } }),
  ]);
  return (await subtree.pluck('UUID')) as string[];
}

/**
 * Refuses the write on `tx` with a `422` unless `reach` still admits every row in `uuids`.
 * `uuids` may repeat a row, as a named row inside a named folder's subtree does.
 */
export async function assertReached(
  tx: Transaction,
  reach: UploadReach | undefined,
  uuids: readonly string[],
): Promise<void> {
  if (isUndefined(reach?.where)) return;
  for (const batch of chunk(uniqueArray(uuids), 900)) {
    const count = await reached(reach, tx)
      .where({ UUID: { in: batch } })
      .count();
    if (count < batch.length) throw uploadsError('', 'outOfReach');
  }
}

/**
 * The reaches a write at `locale` keeps its rows inside: `reach`, and `reach` at `locale` when that differs.
 * An omitted `locale` is the default one, where the write lands.
 */
export function reachesAt(
  reach: UploadReach | undefined,
  locale: LocaleCode | undefined,
): UploadReach[] {
  if (isUndefined(reach)) return [];
  return reach.locale === locale ? [reach] : [reach, { ...reach, locale }];
}

/**
 * `Uploads` under `reach` when given, on `tx` when given.
 */
export function reached(reach: UploadReach | undefined, tx?: Transaction): UntypedQueryBuilder {
  const uploads = queryUntyped('Uploads');
  if (!isUndefined(reach)) applyScope(uploads, reach);
  return isUndefined(tx) ? uploads : uploads.use(tx);
}
