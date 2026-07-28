import {
  checkWriteInput,
  defineHandler,
  queryMetadata,
  queryUntyped,
  readRecordBody,
  setResponseStatus,
} from 'ohne';
import { isNull } from 'ohne/utils';

import { gateCollection, writeLocale } from '../../../collections-api/gate.ts';

/**
 * `POST /collections/[collection]`
 *
 * Creates one record from the JSON body and answers `201` with it.
 * `?locale=` writes a translatable collection at that locale.
 * A validation failure is a `422` with per-field messages; a busy database a `503`.
 */
export default defineHandler(async ({ params }) => {
  const gate = await gateCollection(params.collection, 'create');
  if (!gate.ok) return gate.response;
  const meta = queryMetadata(gate.collection);
  const locale = writeLocale(meta);
  const input = await readRecordBody();
  checkWriteInput(input, meta.fields, 'create');
  const builder = queryUntyped(gate.collection);
  const record = await (isNull(locale) ? builder : builder.locale(locale)).createOrThrow(input);
  setResponseStatus(201);
  return record;
});
