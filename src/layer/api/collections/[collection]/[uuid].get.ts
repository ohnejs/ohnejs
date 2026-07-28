import {
  applyQuery,
  defineHandler,
  parseQueryParams,
  queryMetadata,
  queryUntyped,
  resolveGuards,
} from 'ohne';
import { isUndefined } from 'ohne/utils';

import { notFound } from '../../../../ohne/http/http-error.ts';
import { gateCollection, recordParams } from '../../../collections-api/gate.ts';

/**
 * `GET /collections/[collection]/[uuid]`
 *
 * Reads one record by its `UUID`.
 * `select`, `populate`, and `locale` shape the record; any other param is a `400`.
 * No matching record is a `404`.
 */
export default defineHandler(async ({ params }) => {
  const gate = await gateCollection(params.collection, 'read');
  if (!gate.ok) return gate.response;
  const parsed = parseQueryParams(recordParams(), queryMetadata(gate.collection), resolveGuards());
  const record = await applyQuery(queryUntyped(gate.collection), parsed, {
    where: { UUID: params.uuid },
  }).findFirst();
  if (isUndefined(record)) throw notFound();
  return record;
});
