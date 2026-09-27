import {
  applyQuery,
  defineHandler,
  parseQueryParams,
  queryMetadata,
  queryUntyped,
  resolveGuards,
} from 'ohnejs';
import { isEmpty, isUndefined } from 'ohnejs/utils';

import { notFound } from '../../../../../ohne/http/http-error.ts';
import { translationLocales } from '../../../../../ohne/query/read/translation-locales.ts';
import {
  assertNoParams,
  gateCollection,
  visibleLocales,
} from '../../../../collections-api/gate.ts';

/**
 * `GET /collections/[collection]/[uuid]/translations`
 *
 * Lists the locales holding a translation of one record, in the configured locale order.
 * The endpoint takes no params; any param is a `400`.
 * A non-translatable collection, or a scope `select` without `_translations`, answers the identical `404`.
 * The operation's `access` scope ANDs in; its `where` reads per locale, as the scoped record read does.
 * A locale the scope hides never lists, and a record visible at no locale answers the same `404`.
 * The answer equals the record's own `_translations` as a scoped read returns it.
 */
export default defineHandler(async ({ params }) => {
  const gate = await gateCollection(params.collection, 'read');
  if (!gate.ok) return gate.response;
  assertNoParams();
  const meta = queryMetadata(gate.collection);
  const { select, where } = gate.scope;
  if (meta.translatable !== true || select?.includes('_translations') === false) throw notFound();
  if (isUndefined(where)) {
    const record = await applyQuery(
      queryUntyped(gate.collection).where({ UUID: params.uuid }),
      parseQueryParams({ select: 'UUID' }, meta, resolveGuards()),
      gate.scope,
    ).findFirst();
    if (isUndefined(record)) throw notFound();
    return { locales: await translationLocales(gate.collection, params.uuid) };
  }
  const visible = await visibleLocales(gate.collection, meta, where, [params.uuid]);
  const admitted = [...visible].filter(([, uuids]) => uuids.has(params.uuid)).map(([code]) => code);
  if (isEmpty(admitted)) throw notFound();
  const held = await translationLocales(gate.collection, params.uuid);
  return { locales: held.filter((locale) => admitted.includes(locale)) };
});
