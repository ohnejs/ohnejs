import {
  applyQuery,
  defineHandler,
  parseQueryParams,
  queryMetadata,
  queryUntyped,
  resolveGuards,
} from 'ohne';
import { isEmpty, isUndefined } from 'ohne/utils';

import { notFound } from '../../../../../ohne/http/http-error.ts';
import { queryLocales } from '../../../../../ohne/query/locale.ts';
import { translationLocales } from '../../../../../ohne/query/read/translation-locales.ts';
import { assertNoParams, gateCollection } from '../../../../collections-api/gate.ts';

/**
 * `GET /collections/[collection]/[uuid]/translations`
 *
 * Lists the locales holding a translation of one record, in the configured locale order.
 * The endpoint takes no params; any param is a `400`.
 * A non-translatable collection answers the identical `404`, so the API reveals nothing.
 * The operation's `access` scope ANDs in; its `where` reads per locale, as the scoped record read does.
 * A locale the scope hides never lists, and a record visible at no locale answers the same `404`.
 */
export default defineHandler(async ({ params }) => {
  const gate = await gateCollection(params.collection, 'read');
  if (!gate.ok) return gate.response;
  assertNoParams();
  const meta = queryMetadata(gate.collection);
  if (meta.translatable !== true) throw notFound();
  const visibleAt = async (locale?: string): Promise<boolean> => {
    const parsed = parseQueryParams(
      isUndefined(locale) ? { select: 'UUID' } : { select: 'UUID', locale },
      meta,
      resolveGuards(),
    );
    const record = await applyQuery(
      queryUntyped(gate.collection).where({ UUID: params.uuid }),
      parsed,
      gate.scope,
    ).findFirst();
    return !isUndefined(record);
  };
  if (isUndefined(gate.scope.where)) {
    if (!(await visibleAt())) throw notFound();
    return { locales: await translationLocales(gate.collection, params.uuid) };
  }
  // A scope `where` over translatable fields matches per locale, so each locale probes separately.
  const visible: string[] = [];
  for (const locale of queryLocales().locales) {
    if (await visibleAt(locale)) visible.push(locale);
  }
  if (isEmpty(visible)) throw notFound();
  const held = await translationLocales(gate.collection, params.uuid);
  return { locales: held.filter((locale) => visible.includes(locale)) };
});
