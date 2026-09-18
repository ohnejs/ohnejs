import {
  checkWriteInput,
  defineHandler,
  queryMetadata,
  queryUntyped,
  setResponseStatus,
} from 'ohnejs';
import { isNull, isUndefined } from 'ohnejs/utils';

import {
  accessScope,
  admitCollection,
  readWriteBody,
  scopedRecord,
  writeLocale,
} from '../../../collections-api/gate.ts';

/**
 * `POST /collections/[collection]`
 *
 * Creates one record from the JSON body and answers `201` with it.
 * `?locale=` writes a translatable collection at that locale.
 * The operation's `access` resolver judges the body as its input.
 * A create has no rows to filter, so only the verdict gates, and a refusal answers `404` before any `400`.
 * The answered record narrows to the scope's `select`.
 * A validation failure is a `422` with per-field messages; a busy database a `503`.
 */
export default defineHandler(async ({ params }) => {
  const admitted = await admitCollection(params.collection, 'create');
  if (!admitted.ok) return admitted.response;
  const meta = queryMetadata(admitted.collection);
  const { input, failure } = await readWriteBody();
  const scope = await accessScope(admitted.endpoint, { operation: 'create', input });
  const locale = writeLocale(meta);
  if (!isUndefined(failure)) throw failure;
  checkWriteInput(input, meta.fields, 'create');
  const builder = queryUntyped(admitted.collection);
  const record = await (isNull(locale) ? builder : builder.locale(locale)).createOrThrow(input);
  setResponseStatus(201);
  return scopedRecord(record, scope);
});
