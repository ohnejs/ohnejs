import type { Transaction } from 'ohne';

import { queryUntyped } from 'ohne';
import { isUndefined } from 'ohne/utils';

import type { UploadRecord } from './types.ts';

import { notFound } from '../../ohne/http/http-error.ts';
import { decorateUpload } from './decorate.ts';

/**
 * An `Uploads` row as the query layer returns it, before `decorateUpload` adds `path` and `url`.
 */
export type UploadRow = Omit<UploadRecord, 'path' | 'url' | 'thumbnail'>;

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
 * Decorates a row the query layer returned and types it as the record every helper answers.
 */
export function decorated(row: Record<string, unknown>): UploadRecord {
  decorateUpload(row);
  return row as unknown as UploadRecord;
}
