import { checkWriteInput, defineHandler, queryMetadata, queryUntyped, readRecordBody } from 'ohne';
import { isNull, isUndefined, pick } from 'ohne/utils';

import { notFound } from '../../../../ohne/http/http-error.ts';
import { gateCollection, scopedRecord, writeLocale } from '../../../collections-api/gate.ts';

/**
 * `PATCH /collections/[collection]/[uuid]`
 *
 * Updates one record from the JSON body and answers with its final state.
 * `?locale=` writes a translatable collection at that locale.
 * The operation's `access` scope ANDs in, so an out-of-scope record answers the same `404`.
 * The scope's `select` narrows both the accepted input and the answered record.
 * No matching record is a `404`; a validation failure a `422` with per-field messages.
 */
export default defineHandler(async ({ params }) => {
  const gate = await gateCollection(params.collection, 'update');
  if (!gate.ok) return gate.response;
  const meta = queryMetadata(gate.collection);
  const locale = writeLocale(meta);
  const raw = await readRecordBody();
  const input = isUndefined(gate.scope.select) ? raw : pick(raw, gate.scope.select);
  checkWriteInput(input, meta.fields, 'update');
  const builder = queryUntyped(gate.collection).where({ UUID: params.uuid });
  if (!isUndefined(gate.scope.where)) builder.where(gate.scope.where);
  const records = await (isNull(locale) ? builder : builder.locale(locale)).updateOrThrow(input);
  if (records.length === 0) throw notFound();
  return scopedRecord(records[0], gate.scope);
});
