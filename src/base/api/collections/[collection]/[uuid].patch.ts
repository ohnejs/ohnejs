import { checkWriteInput, defineHandler, queryMetadata, queryUntyped } from 'ohnejs';
import { isNull, isUndefined, pick } from 'ohnejs/utils';

import { notFound } from '../../../../ohne/http/http-error.ts';
import {
  accessScope,
  admitCollection,
  linkReach,
  readWriteBody,
  scopedRecord,
  writeLocale,
} from '../../../collections-api/gate.ts';

/**
 * `PATCH /collections/[collection]/[uuid]`
 *
 * Updates one record from the JSON body and answers with its final state.
 * `?locale=` writes a translatable collection at that locale.
 * The operation's `access` resolver judges the body as its input; a refusal answers `404` before any `400`.
 * Its scope's `where` ANDs in, so an out-of-scope record answers the same `404`.
 * A key the collection cannot take is a `422` naming the field.
 * A key outside the scope's `select` is the identical `422`, so a `200` means every sent key was written.
 * The scope's `select` narrows the answered record.
 * Its `where` also narrows the answered `_translations` to the locales it admits the record at.
 * No matching record is a `404`; a validation failure a `422` with per-field messages.
 */
export default defineHandler(async ({ params }) => {
  const admitted = await admitCollection(params.collection, 'update');
  if (!admitted.ok) return admitted.response;
  const meta = queryMetadata(admitted.collection);
  const { input, failure } = await readWriteBody();
  const scope = await accessScope(admitted.endpoint, { operation: 'update', input });
  const locale = writeLocale(meta);
  if (!isUndefined(failure)) throw failure;
  const fields = isUndefined(scope.select) ? meta.fields : pick(meta.fields, scope.select);
  checkWriteInput(input, fields, 'update');
  const builder = queryUntyped(admitted.collection)
    .linkReach(linkReach)
    .where({ UUID: params.uuid });
  if (!isUndefined(scope.where)) builder.access(scope.where);
  const records = await (isNull(locale) ? builder : builder.locale(locale)).updateOrThrow(input);
  if (records.length === 0) throw notFound();
  return scopedRecord(records[0], scope);
});
