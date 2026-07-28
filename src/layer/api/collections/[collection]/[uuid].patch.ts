import { checkWriteInput, defineHandler, queryMetadata, queryUntyped, readRecordBody } from 'ohne';
import { isNull } from 'ohne/utils';

import { notFound } from '../../../../ohne/http/http-error.ts';
import { gateCollection, writeLocale } from '../../../collections-api/gate.ts';

/**
 * `PATCH /collections/[collection]/[uuid]`
 *
 * Updates one record from the JSON body and answers with its final state.
 * `?locale=` writes a translatable collection at that locale.
 * No matching record is a `404`; a validation failure a `422` with per-field messages.
 */
export default defineHandler(async ({ params }) => {
  const gate = await gateCollection(params.collection, 'update');
  if (!gate.ok) return gate.response;
  const meta = queryMetadata(gate.collection);
  const locale = writeLocale(meta);
  const input = await readRecordBody();
  checkWriteInput(input, meta.fields, 'update');
  const builder = queryUntyped(gate.collection).where({ UUID: params.uuid });
  const records = await (isNull(locale) ? builder : builder.locale(locale)).updateOrThrow(input);
  if (records.length === 0) throw notFound();
  return records[0];
});
