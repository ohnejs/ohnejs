import type { SearchParamValue } from 'ohne/utils';

import {
  defineHandler,
  type LocaleCode,
  parseLocaleParam,
  queryMetadata,
  queryUntyped,
  readRecordBody,
  useCollections,
} from 'ohne';
import { isEmpty, isNull, isUndefined, pick } from 'ohne/utils';

import { notFound } from '../../../../../../ohne/http/http-error.ts';
import { queryLocales } from '../../../../../../ohne/query/locale.ts';
import { sameLocaleError, unknownParamError } from '../../../../../../ohne/query/wire/errors.ts';
import { copyTranslationInput } from '../../../../../../ohne/query/write/copy-translation.ts';
import { gateCollection, scopedRecord, writeLocale } from '../../../../../collections-api/gate.ts';

/**
 * `POST /collections/[collection]/[uuid]/translations/copy`
 *
 * Copies one record's translation onto another locale and answers the record's state there.
 * `?locale=` names the target, defaulting to the default locale, as every write's `locale` does.
 * The JSON body's only key is an optional `source`, the locale to copy from, defaulting the same way.
 * Any other body key is a `400`, as is a `source` equal to the target - a copy needs two locales.
 * Only translatable, writable, mutable fields ever write, whatever a `copyTranslation` hook returns.
 * The operation's `access` scope ANDs in, so an out-of-scope record answers the same `404`.
 * A non-translatable collection and a missing record answer that identical `404`.
 * A validation failure answers `422` with per-field messages.
 */
export default defineHandler(async ({ params }) => {
  const gate = await gateCollection(params.collection, 'update');
  if (!gate.ok) return gate.response;
  const meta = queryMetadata(gate.collection);
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

  const reader = queryUntyped(gate.collection).where({ UUID: params.uuid });
  if (!isUndefined(gate.scope.where)) reader.where(gate.scope.where);
  const record = await (isNull(source) ? reader : reader.locale(source)).findFirst();
  if (isUndefined(record)) throw notFound();

  let input = copyTranslationInput(meta.fields, record);
  const hook = useCollections().get(gate.collection)?.collection.copyTranslation;
  if (!isUndefined(hook)) {
    input = copyTranslationInput(
      meta.fields,
      await hook({ source: record, input, sourceLocale, targetLocale }),
    );
  }
  if (!isUndefined(gate.scope.select)) input = pick(input, gate.scope.select);

  const writer = queryUntyped(gate.collection).where({ UUID: params.uuid });
  if (!isUndefined(gate.scope.where)) writer.where(gate.scope.where);
  const scoped = isNull(target) ? writer : writer.locale(target);
  // An empty update would still bump `_updatedAt`, so a copy carrying nothing skips the write.
  if (isEmpty(input)) {
    const current = await scoped.findFirst();
    if (isUndefined(current)) throw notFound();
    return scopedRecord(current, gate.scope);
  }
  const records = await scoped.updateOrThrow(input);
  if (isEmpty(records)) throw notFound();
  return scopedRecord(records[0], gate.scope);
});
