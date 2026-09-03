import { checkWriteInput, defineHandler, queryMetadata, queryUntyped } from 'ohne';
import { isNull, isUndefined, pick } from 'ohne/utils';

import { notFound } from '../../../../ohne/http/http-error.ts';
import {
  accessScope,
  admitCollection,
  readWriteBody,
  scopedRecord,
  scopeTranslations,
  writeLocale,
} from '../../../collections-api/gate.ts';

/**
 * `PATCH /collections/[collection]/[uuid]`
 *
 * Updates one record from the JSON body and answers with its final state.
 * `?locale=` writes a translatable collection at that locale.
 * The operation's `access` resolver judges the body as its input; a refusal answers `404` before any `400`.
 * Its scope's `where` ANDs in, so an out-of-scope record answers the same `404`.
 * The scope's `select` narrows both the accepted input and the answered record.
 * Its `where` also narrows the answered `_translations` to the locales it admits the record at.
 * No matching record is a `404`; a validation failure a `422` with per-field messages.
 */
export default defineHandler(async ({ params }) => {
  const admitted = await admitCollection(params.collection, 'update');
  if (!admitted.ok) return admitted.response;
  const meta = queryMetadata(admitted.collection);
  const { input: raw, failure } = await readWriteBody();
  const scope = await accessScope(admitted.endpoint, { operation: 'update', input: raw });
  const locale = writeLocale(meta);
  if (!isUndefined(failure)) throw failure;
  const input = isUndefined(scope.select) ? raw : pick(raw, scope.select);
  checkWriteInput(input, meta.fields, 'update');
  const builder = queryUntyped(admitted.collection).where({ UUID: params.uuid });
  if (!isUndefined(scope.where)) builder.where(scope.where);
  const records = await (isNull(locale) ? builder : builder.locale(locale)).updateOrThrow(input);
  if (records.length === 0) throw notFound();
  const answer = scopedRecord(records[0], scope);
  await scopeTranslations([answer], admitted.collection, meta, scope);
  return answer;
});
