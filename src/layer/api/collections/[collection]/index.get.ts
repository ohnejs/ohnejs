import {
  defineHandler,
  parseQueryParams,
  queryMetadata,
  resolveGuards,
  scopedMetadata,
  useSearchParams,
} from 'ohne';

import { gateCollection, listRecords } from '../../../collections-api/gate.ts';

/**
 * `GET /collections/[collection]`
 *
 * Lists an exposed collection's records through the wire query grammar.
 * `where`, `select`, `order`, `populate`, the row window, and `locale` ride the URL.
 * A `page`/`perPage` request answers the paginated envelope; anything else a plain array.
 * The operation's `access` scope narrows the rows and fields the request may reach.
 * A field outside the scope's `select` is refused wherever the URL names it, as an unknown field is.
 * An unknown or unexposed collection is a `404`; a bad query a `400` with its code and path.
 */
export default defineHandler(async ({ params }) => {
  const gate = await gateCollection(params.collection, 'read');
  if (!gate.ok) return gate.response;
  const parsed = parseQueryParams(
    useSearchParams(),
    scopedMetadata(queryMetadata(gate.collection), gate.scope),
    resolveGuards(),
  );
  return listRecords(gate.collection, parsed, gate.scope);
});
