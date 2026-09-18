import { defineHandler, queryUntyped } from 'ohnejs';
import { isUndefined } from 'ohnejs/utils';

import { notFound } from '../../../../ohne/http/http-error.ts';
import { assertNoParams, gateCollection } from '../../../collections-api/gate.ts';

/**
 * `DELETE /collections/[collection]/[uuid]`
 *
 * Deletes one record by its `UUID`, every locale and derived row included, answering `204`.
 * The operation's `access` scope ANDs in, so an out-of-scope record answers the same `404`.
 * The endpoint takes no params; nothing deleted is a `404`.
 * A `restrict` reference into the record is a `409`.
 */
export default defineHandler(async ({ params }) => {
  const gate = await gateCollection(params.collection, 'delete');
  if (!gate.ok) return gate.response;
  assertNoParams();
  const builder = queryUntyped(gate.collection).where({ UUID: params.uuid });
  if (!isUndefined(gate.scope.where)) builder.where(gate.scope.where);
  const { deleted } = await builder.delete();
  if (deleted === 0) throw notFound();
  return null;
});
