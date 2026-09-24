import type { Transaction } from 'ohnejs';

import { queryUntyped } from 'ohnejs';
import { chunk, isUndefined } from 'ohnejs/utils';

import type { UploadDecorations, UploadRecord } from './types.ts';

import { notFound } from '../../ohne/http/http-error.ts';
import { decorateUpload } from './decorate.ts';
import { ancestorDirectories, uploadPath } from './path.ts';

/**
 * An `Uploads` row as the query layer returns it, before `decorateUpload` adds the `UploadDecorations`.
 */
export type UploadRow = Omit<UploadRecord, keyof UploadDecorations>;

/**
 * Reads one row by `UUID`, on `tx` when the caller holds one, or throws the `404`.
 */
export async function readUpload(uuid: string, tx?: Transaction): Promise<UploadRow> {
  const builder = queryUntyped('Uploads');
  const row = await (isUndefined(tx) ? builder : builder.use(tx)).where({ UUID: uuid }).findFirst();
  if (isUndefined(row)) throw notFound();
  return row as UploadRow;
}

/**
 * Reads the rows `uuids` name on `tx`, in that order, or throws the `404` when any is missing.
 * `uuids` must hold no duplicates.
 */
export async function readUploads(uuids: readonly string[], tx: Transaction): Promise<UploadRow[]> {
  const rows = new Map<string, UploadRow>();
  for (const batch of chunk(uuids, 900)) {
    const found = await queryUntyped('Uploads')
      .use(tx)
      .where({ UUID: { in: batch } })
      .findMany();
    for (const row of found) rows.set(row.UUID as string, row as UploadRow);
  }
  if (rows.size < uuids.length) throw notFound();
  return uuids.map((uuid) => rows.get(uuid) as UploadRow);
}

/**
 * The rows of `rows` inside no folder among them, since a folder carries its subtree along.
 */
export function outermostRows(rows: readonly UploadRow[]): UploadRow[] {
  const folders = new Set(rows.filter((row) => row.kind === 'folder').map(uploadPath));
  return rows.filter(
    (row) => !ancestorDirectories(row.directory).some((path) => folders.has(path)),
  );
}

/**
 * Decorates a row the query layer returned and types it as the record every helper answers.
 */
export function decorated(row: Record<string, unknown>): UploadRecord {
  decorateUpload(row);
  return row as unknown as UploadRecord;
}
