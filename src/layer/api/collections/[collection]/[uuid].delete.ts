import { defineHandler, queryUntyped } from 'ohne';

import { notFound } from '../../../../ohne/http/http-error.ts';
import { assertNoParams, gateCollection } from '../../../collections-api/gate.ts';

/**
 * `DELETE /collections/[collection]/[uuid]`
 *
 * Deletes one record by its `UUID`, every locale and derived row included, answering `204`.
 * The endpoint takes no params; nothing deleted is a `404`.
 * A `restrict` reference into the record is a `409`.
 */
export default defineHandler(async ({ params }) => {
  const gate = await gateCollection(params.collection, 'delete');
  if (!gate.ok) return gate.response;
  assertNoParams();
  const { deleted } = await queryUntyped(gate.collection).where({ UUID: params.uuid }).delete();
  if (deleted === 0) throw notFound();
  return null;
});
