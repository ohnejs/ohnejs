import {
  checkWriteInput,
  defineHandler,
  type LocaleCode,
  queryMetadata,
  queryUntyped,
  setResponseStatus,
} from 'ohnejs';
import { isNull, isUndefined, pick } from 'ohnejs/utils';

import { notFound } from '../../../../../ohne/http/http-error.ts';
import { isTranslatableEntry } from '../../../../../ohne/query/metadata.ts';
import { duplicateDraft } from '../../../../../ohne/query/write/duplicate.ts';
import {
  accessScope,
  admitCollection,
  deferredWriteLocale,
  linkReach,
  readReach,
  readWriteBody,
  scopedRecord,
} from '../../../../collections-api/gate.ts';

/**
 * `POST /collections/[collection]/[uuid]/duplicate`
 *
 * Copies one record into a new one, every locale it holds included, and answers `201` with the copy.
 * The JSON body holds the fields to change on the copy, `{}` when there is nothing to change.
 * `?locale=` is the locale the copy is created at, where the body's values land.
 * Omitted, it is the default locale when the source holds it, else the source's first held locale.
 * Top-level `unique` fields and `copy: false` types are left out.
 * The collection's `duplicate` function shapes the rest.
 * It runs under `read` and `create`: the source reads as the caller's read does, its middleware included.
 * The read scope's `where` and `select` bound what the copy can carry, rows, fields, and locales alike.
 * `create`'s `access` judges the copy once per locale it writes, with its values and the shared ones.
 * Copied links are new links, so each must be one the caller can read.
 * A refusal, a missing source, a closed operation, and a `duplicate: false` collection answer the same `404`.
 * Each answers before any `400`.
 * The answered record narrows to the create scope's `select`.
 * A validation failure is a `422` with per-field messages, naming `locale` when one locale failed.
 */
export default defineHandler(async ({ params }) => {
  const admitted = await admitCollection(params.collection, 'create');
  if (!admitted.ok) return admitted.response;
  const meta = queryMetadata(admitted.collection);
  if (meta.duplicate === false) throw notFound();
  const read = await readReach(admitted.collection);
  if (read === false) throw notFound();
  const { input: overrides, failure } = await readWriteBody();
  const { locale, failure: localeFailure } = deferredWriteLocale(meta);

  const draft = await duplicateDraft(admitted.collection, locale as LocaleCode | null, (code) => {
    const source = queryUntyped(admitted.collection).where({ UUID: params.uuid });
    if (!isUndefined(read.where)) source.access(read.where);
    if (!isUndefined(read.select)) source.select(...read.select);
    return (isNull(code) ? source : source.locale(code)).findFirst();
  });
  if (isUndefined(draft)) throw notFound();
  const input = { ...draft.input, ...overrides };
  const scope = await accessScope(admitted.endpoint, { operation: 'create', input });
  const shared = pick(
    input,
    Object.keys(input).filter((name) => {
      const field = meta.fields[name];
      return isUndefined(field) || !isTranslatableEntry(field);
    }),
  );
  for (const values of Object.values(draft.locales)) {
    await accessScope(admitted.endpoint, { operation: 'create', input: { ...shared, ...values } });
  }
  if (!isUndefined(failure)) throw failure;
  if (!isUndefined(localeFailure)) throw localeFailure;
  checkWriteInput(overrides, meta.fields, 'create');

  const builder = queryUntyped(admitted.collection).linkReach(linkReach);
  const writer = isNull(draft.locale) ? builder : builder.locale(draft.locale);
  const record = await writer.createOrThrow(input, { locales: draft.locales });
  setResponseStatus(201);
  return scopedRecord(record, scope);
});
