import { defineHandler, readQueryBody } from 'ohnejs';

import { assertNoParams, gateCollection } from '../../../collections-api/gate.ts';
import { resolveVerdicts } from '../../../collections-api/verdicts.ts';

/**
 * `POST /collections/[collection]/verdicts`
 *
 * Answers which rows the caller's update and delete would touch, before any write runs.
 * The request admits as a read, and a verdict only ever covers rows the read lists.
 * A body naming `UUIDs` answers the rows each operation may touch; one describing a `where` answers counts.
 * `locale` picks the locale the update and the translation delete read at; a whole delete reads the default.
 * The update and delete `access` resolvers run without their middleware, an update with an empty input.
 * A closed operation, a missing capability, and a refusing resolver all answer no row.
 * The update verdict carries the update scope's `select`, the fields a write may set.
 * `deleteTranslation` answers on a translatable collection alone.
 * The URL takes no params; an unknown body key, or `where` beside `UUIDs`, is a `400`.
 */
export default defineHandler(async ({ params }) => {
  const gate = await gateCollection(params.collection, 'read');
  if (!gate.ok) return gate.response;
  assertNoParams();
  return resolveVerdicts(gate.collection, gate.scope, await readQueryBody());
});
