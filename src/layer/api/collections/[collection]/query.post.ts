import {
  defineHandler,
  parseQueryParams,
  queryMetadata,
  readQueryBody,
  resolveGuards,
  scopedMetadata,
} from 'ohne';

import { assertNoParams, gateCollection, listRecords } from '../../../collections-api/gate.ts';

/**
 * `POST /collections/[collection]/query`
 *
 * The list read from a JSON body - for a query too long for a URL.
 * The body carries the same top-level params the `GET` list takes, and both parse identically.
 * The URL itself takes no params here; the body is the query.
 */
export default defineHandler(async ({ params }) => {
  const gate = await gateCollection(params.collection, 'read');
  if (!gate.ok) return gate.response;
  assertNoParams();
  const parsed = parseQueryParams(
    await readQueryBody(),
    scopedMetadata(queryMetadata(gate.collection), gate.scope),
    resolveGuards(),
  );
  return listRecords(gate.collection, parsed, gate.scope);
});
