import type { Transaction } from 'ohnejs';

import { chunk, isUndefined } from 'ohnejs/utils';

import type { UploadReach } from './_reach.ts';
import type { UploadDecorations, UploadRecord } from './types.ts';

import { notFound } from '../../ohne/http/http-error.ts';
import { reached } from './_reach.ts';
import { decorateUpload } from './decorate.ts';
import { ancestorDirectories, uploadPath } from './path.ts';

/**
 * An `Uploads` row as the query layer returns it, before `decorateUpload` adds the `UploadDecorations`.
 */
export type UploadRow = Omit<UploadRecord, keyof UploadDecorations>;

/**
 * Reads one row by `UUID`, on `tx` when the caller holds one, or throws the `404`.
 * With `reach`, a row it hides is the `404`, and `_translations` lists only the locales it admits.
 */
export async function readUpload(
  uuid: string,
  tx?: Transaction,
  reach?: UploadReach,
): Promise<UploadRow> {
  const row = await reached(reach, tx).where({ UUID: uuid }).findFirst();
  if (isUndefined(row)) throw notFound();
  return row as UploadRow;
}

/**
 * Reads the rows `uuids` name on `tx`, in that order, or throws the `404` when any is missing.
 * `uuids` must hold no duplicates.
 * With `reach`, one it hides is missing, and `_translations` lists only the locales it admits.
 */
export async function readUploads(
  uuids: readonly string[],
  tx: Transaction,
  reach?: UploadReach,
): Promise<UploadRow[]> {
  const rows = new Map<string, UploadRow>();
  for (const batch of chunk(uuids, 900)) {
    const found = await reached(reach, tx)
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
