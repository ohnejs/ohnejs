import type { CollectionQueryMeta, ConditionInput, QueryScope } from 'ohnejs';
import type { SearchParamValue } from 'ohnejs/utils';

import {
  admittedUUIDs,
  applyQuery,
  parseLocaleParam,
  parseWireQuery,
  queryMetadata,
  queryUntyped,
  resolveGuards,
  scopedMetadata,
} from 'ohnejs';
import { isArray, isString, isUndefined, pick, uniqueArray } from 'ohnejs/utils';

import { checkQueryLocale, effectiveLocale } from '../../ohne/query/locale.ts';
import { invalidValueError, limitError, unknownParamError } from '../../ohne/query/wire/errors.ts';
import { localeSensitive } from '../../ohne/query/wire/withheld-metadata.ts';
import { readReach, writeReach } from './gate.ts';

/**
 * A row-form verdict: the asked rows the operation may touch.
 */
export interface RowVerdict {
  /**
   * The asked `UUID`s inside the operation's scope, in the order the request named them.
   */
  UUIDs: string[];
}

/**
 * A query-form verdict: how many of the described rows the operation may touch.
 */
export interface CountVerdict {
  /**
   * The rows of the described list inside the operation's scope.
   */
  total: number;
}

/**
 * One operation's verdict over the asked rows, named in the row form and counted in the query form.
 */
export type Verdict = RowVerdict | CountVerdict;

/**
 * The update verdict, carrying the update scope's field limit beside the rows.
 */
export type UpdateVerdict = Verdict & {
  /**
   * The fields an update may write: the update scope's `select`.
   * Omitted means the scope limits no field.
   */
  select?: string[];
};

/**
 * What `POST /collections/[collection]/verdicts` answers: each write's verdict over the asked rows.
 * Every verdict reads at the locale its write reads at.
 */
export interface Verdicts {
  /**
   * The rows an update may touch, read at the asked locale.
   */
  update: UpdateVerdict;

  /**
   * The rows a whole-record delete may touch, read at the default locale as that delete reads.
   */
  delete: Verdict;

  /**
   * The rows whose translation at the asked locale a delete may remove.
   * Present on a translatable collection alone.
   */
  deleteTranslation?: Verdict;
}

/**
 * The asked rows of one request form, narrowed per operation.
 * `narrow` answers the asked rows a scope `where` admits at one locale, `null` being the default.
 */
interface AskedRows {
  locale: string | null;
  refused: Verdict;
  narrow(where: ConditionInput | undefined, locale: string | null): Promise<Verdict>;
}

/**
 * The keys a verdicts body may carry.
 */
const BODY_KEYS = new Set(['UUIDs', 'where', 'locale']);

/**
 * The rows a query-form walk reads per step, one probe chunk each.
 */
const WALK_SIZE = 900;

/**
 * Resolves the caller's update and delete verdicts over the rows a verdicts body asks about.
 *
 * The caller has passed the read gate; `readScope` is its scope.
 * A body naming `UUIDs` is the row form, answered with the rows.
 * Any other body is the query form, answered with counts.
 * The asked rows are always rows the read lists, so a verdict never names a row the read scope hides.
 * An operation that reaches nothing answers no row, and one whose scope has no `where` every asked row.
 * A malformed body throws the wire `400` its failure maps to.
 */
export async function resolveVerdicts(
  collection: string,
  readScope: QueryScope,
  body: Record<string, SearchParamValue>,
): Promise<Verdicts> {
  for (const key of Object.keys(body)) {
    if (!BODY_KEYS.has(key)) throw unknownParamError(key);
  }
  const meta = queryMetadata(collection);
  const asked = isUndefined(body.UUIDs)
    ? await queryForm(collection, meta, readScope, body)
    : rowForm(collection, meta, readScope, body);
  const updateReach = await writeReach(collection, 'update');
  const deleteReach = await writeReach(collection, 'delete');
  const verdict = async (reach: QueryScope | false, locale: string | null): Promise<Verdict> =>
    reach === false ? asked.refused : asked.narrow(reach.where, locale);

  const update = await verdict(updateReach, asked.locale);
  const whole = await verdict(deleteReach, null);
  const answer: Verdicts = {
    update:
      updateReach === false || isUndefined(updateReach.select)
        ? update
        : { ...update, select: updateReach.select },
    delete: whole,
  };
  if (meta.translatable === true) {
    const alike = deleteReach === false || readsAlike(deleteReach.where, meta, asked.locale, null);
    answer.deleteTranslation = alike ? whole : await verdict(deleteReach, asked.locale);
  }
  return answer;
}

/**
 * The row form: the body names `UUIDs`, and each verdict names the ones its operation may touch.
 * The read scope's `where` narrows them first, at the list locale, on the first verdict that probes.
 * A `where` beside `UUIDs`, a list that is not strings, and one past `maxInLength` each throw.
 */
function rowForm(
  collection: string,
  meta: CollectionQueryMeta,
  readScope: QueryScope,
  body: Record<string, SearchParamValue>,
): AskedRows {
  if (!isUndefined(body.where)) throw invalidValueError('where');
  const named = body.UUIDs;
  if (!isArray<string[]>(named) || !named.every(isString)) throw invalidValueError('UUIDs');
  const { maxInLength } = resolveGuards();
  if (named.length > maxInLength) throw limitError('listTooLong', 'UUIDs', maxInLength);
  const locale = parseLocaleParam(body.locale, meta);
  const listLocale = locale ?? readScope.locale ?? null;
  let listed: Promise<string[]> | undefined;
  return {
    locale,
    refused: { UUIDs: [] },
    narrow: async (where, at) => {
      listed ??= admittedRows(collection, meta, readScope.where, uniqueArray(named), listLocale);
      return { UUIDs: await admittedRows(collection, meta, where, await listed, at) };
    },
  };
}

/**
 * The query form: the body describes a list as the list read's `where` does, and each verdict counts.
 * The body parses against the read-scoped metadata under the caller's reach, exactly as the body-query read.
 * A scope `where` that reads alike at the list locale counts in one statement, ANDed into the list.
 * Any other walks the list's `UUID`s at the list locale in bounded steps.
 * Each step probes at the verdict's locale.
 * The walk composes the read scope's `where` and `locale` alone, since its `limit` would cap the walk.
 */
async function queryForm(
  collection: string,
  meta: CollectionQueryMeta,
  readScope: QueryScope,
  body: Record<string, SearchParamValue>,
): Promise<AskedRows> {
  const parsed = await parseWireQuery(
    body,
    scopedMetadata(meta, readScope),
    resolveGuards(),
    readReach,
  );
  const listLocale = parsed.locale ?? readScope.locale ?? null;
  const walked = pick(readScope, ['where', 'locale']);
  let listed: Promise<number> | undefined;
  return {
    locale: parsed.locale,
    refused: { total: 0 },
    narrow: async (where, at) => {
      if (isUndefined(where)) {
        listed ??= applyQuery(queryUntyped(collection), parsed, readScope).count();
        return { total: await listed };
      }
      if (readsAlike(where, meta, at, listLocale)) {
        const builder = queryUntyped(collection).where(where);
        return { total: await applyQuery(builder, parsed, readScope).count() };
      }
      let total = 0;
      for (let offset = 0; ; offset += WALK_SIZE) {
        const uuids = (await applyQuery(queryUntyped(collection), parsed, walked)
          .limit(WALK_SIZE)
          .offset(offset)
          .pluck('UUID')) as string[];
        total += (await admittedUUIDs(collection, meta, where, uuids, at)).size;
        if (uuids.length < WALK_SIZE) return { total };
      }
    },
  };
}

/**
 * The rows among `uuids` a scope `where` admits at one locale, in their given order.
 * A scope without a `where` admits every row and runs no query.
 */
async function admittedRows(
  collection: string,
  meta: CollectionQueryMeta,
  where: ConditionInput | undefined,
  uuids: string[],
  locale: string | null,
): Promise<string[]> {
  if (isUndefined(where)) return uuids;
  const admitted = await admittedUUIDs(collection, meta, where, uuids, locale);
  return uuids.filter((uuid) => admitted.has(uuid));
}

/**
 * Whether a scope `where` admits the same rows read at either locale, so one read serves both.
 * `null` is the default locale; the locales compare as canonical tags.
 */
function readsAlike(
  where: ConditionInput | undefined,
  meta: CollectionQueryMeta,
  a: string | null,
  b: string | null,
): boolean {
  if (isUndefined(where) || !localeSensitive(where, meta)) return true;
  return checkQueryLocale(effectiveLocale(a)) === checkQueryLocale(effectiveLocale(b));
}
