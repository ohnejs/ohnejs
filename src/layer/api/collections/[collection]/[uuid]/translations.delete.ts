import { defineHandler, queryMetadata, queryUntyped } from 'ohne';
import { isUndefined } from 'ohne/utils';

import { notFound } from '../../../../../ohne/http/http-error.ts';
import { queryLocales } from '../../../../../ohne/query/locale.ts';
import { gateCollection, writeLocale } from '../../../../collections-api/gate.ts';

/**
 * `DELETE /collections/[collection]/[uuid]/translations`
 *
 * Deletes one record's translation at one locale and answers `204`; the record itself survives.
 * `?locale=` names the doomed locale, defaulting to the default locale, as every write's `locale` does.
 * Any other param is a `400`.
 * A non-translatable collection answers the identical `404`, so the API reveals nothing.
 * The operation's `access` scope ANDs in, so an out-of-scope record answers the same `404`.
 * A record holding nothing at the locale deletes nothing, and nothing deleted is a `404`.
 */
export default defineHandler(async ({ params }) => {
  const gate = await gateCollection(params.collection, 'delete');
  if (!gate.ok) return gate.response;
  const meta = queryMetadata(gate.collection);
  if (meta.translatable !== true) throw notFound();
  const locale = writeLocale(meta) ?? queryLocales().defaultLocale;
  const builder = queryUntyped(gate.collection).locale(locale).where({ UUID: params.uuid });
  if (!isUndefined(gate.scope.where)) builder.where(gate.scope.where);
  const { deleted } = await builder.deleteTranslation();
  if (deleted === 0) throw notFound();
  return null;
});
