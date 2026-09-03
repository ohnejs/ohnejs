import {
  applyQuery,
  defineHandler,
  parseWireQuery,
  queryMetadata,
  queryUntyped,
  resolveGuards,
  scopedMetadata,
} from 'ohne';
import { isUndefined } from 'ohne/utils';

import { notFound } from '../../../../ohne/http/http-error.ts';
import {
  gateCollection,
  readReach,
  recordParams,
  scopeTranslations,
} from '../../../collections-api/gate.ts';

/**
 * `GET /collections/[collection]/[uuid]`
 *
 * Reads one record by its `UUID`.
 * `select`, `populate`, and `locale` shape the record; any other param is a `400`.
 * The operation's `access` scope ANDs in, so an out-of-scope record answers the same `404`.
 * Its `where` also narrows `_translations` to the locales it admits the record at.
 * A populate reaches a collection only as far as the caller's own read of it would.
 * No matching record is a `404`.
 */
export default defineHandler(async ({ params }) => {
  const gate = await gateCollection(params.collection, 'read');
  if (!gate.ok) return gate.response;
  const meta = queryMetadata(gate.collection);
  const parsed = await parseWireQuery(
    recordParams(),
    scopedMetadata(meta, gate.scope),
    resolveGuards(),
    readReach,
  );
  const record = await applyQuery(
    queryUntyped(gate.collection).where({ UUID: params.uuid }),
    parsed,
    gate.scope,
  ).findFirst();
  if (isUndefined(record)) throw notFound();
  await scopeTranslations([record], gate.collection, meta, gate.scope, parsed.populate);
  return record;
});
