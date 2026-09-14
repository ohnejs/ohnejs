import type { SearchParamValue } from 'ohnejs/utils';

import {
  defineHandler,
  type LocaleCode,
  parseLocaleParam,
  queryMetadata,
  queryUntyped,
  readRecordBody,
  useCollections,
} from 'ohnejs';
import { first, isEmpty, isNull, isUndefined, pick } from 'ohnejs/utils';

import { notFound } from '../../../../../../ohne/http/http-error.ts';
import { queryLocales } from '../../../../../../ohne/query/locale.ts';
import { sameLocaleError, unknownParamError } from '../../../../../../ohne/query/wire/errors.ts';
import { copyTranslationInput } from '../../../../../../ohne/query/write/copy-translation.ts';
import {
  accessScope,
  admitCollection,
  scopedRecord,
  scopeTranslations,
  writeLocale,
} from '../../../../../collections-api/gate.ts';

/**
 * `POST /collections/[collection]/[uuid]/translations/copy`
 *
 * Copies one record's translation onto another locale and answers the record's state there.
 * `?locale=` names the target, defaulting to the default locale, as every write's `locale` does.
 * The JSON body's only key is an optional `source`, the locale to copy from, defaulting the same way.
 * Any other body key is a `400`, as is a `source` equal to the target - a copy needs two locales.
 * Only translatable, writable, mutable fields ever write, whatever a `copyTranslation` hook returns.
 * The `update` resolver runs twice: with an empty input to reach the source, then with the copy it writes.
 * The first runs before any param or body check, so a refused caller answers `404` before any `400`.
 * Each scope's `where` ANDs in, so an out-of-scope record answers the same `404`.
 * The write scope's `where` also narrows the answered `_translations` to the locales it admits the record at.
 * A non-translatable collection and a missing record answer that identical `404`.
 * A validation failure answers `422` with per-field messages.
 */
export default defineHandler(async ({ params }) => {
  const admitted = await admitCollection(params.collection, 'update');
  if (!admitted.ok) return admitted.response;
  const reach = await accessScope(admitted.endpoint, { operation: 'update', input: {} });
  const meta = queryMetadata(admitted.collection);
  if (meta.translatable !== true) throw notFound();
  const target = writeLocale(meta);
  const body = await readRecordBody();
  for (const key of Object.keys(body)) {
    if (key !== 'source') throw unknownParamError(key);
  }
  const source = parseLocaleParam(body.source as SearchParamValue | undefined, meta, 'source');
  const { defaultLocale } = queryLocales();
  // The wire parsers admit only configured locales, so the codegen-narrowed cast holds.
  const sourceLocale = (source ?? defaultLocale) as LocaleCode;
  const targetLocale = (target ?? defaultLocale) as LocaleCode;
  if (sourceLocale === targetLocale) throw sameLocaleError(targetLocale);

  const reader = queryUntyped(admitted.collection).where({ UUID: params.uuid });
  if (!isUndefined(reach.where)) reader.where(reach.where);
  const record = await (isNull(source) ? reader : reader.locale(source)).findFirst();
  if (isUndefined(record)) throw notFound();

  let input = copyTranslationInput(meta.fields, record);
  const hook = useCollections().get(admitted.collection)?.collection.copyTranslation;
  if (!isUndefined(hook)) {
    input = copyTranslationInput(
      meta.fields,
      await hook({ source: record, input, sourceLocale, targetLocale }),
    );
  }
  const scope = await accessScope(admitted.endpoint, { operation: 'update', input });
  if (!isUndefined(scope.select)) input = pick(input, scope.select);

  const writer = queryUntyped(admitted.collection).where({ UUID: params.uuid });
  if (!isUndefined(scope.where)) writer.where(scope.where);
  const scoped = isNull(target) ? writer : writer.locale(target);
  // An empty update would still bump `_updatedAt`, so a copy carrying nothing skips the write.
  const current = isEmpty(input)
    ? await scoped.findFirst()
    : first(await scoped.updateOrThrow(input));
  if (isUndefined(current)) throw notFound();
  const answer = scopedRecord(current, scope);
  await scopeTranslations([answer], admitted.collection, meta, scope);
  return answer;
});
