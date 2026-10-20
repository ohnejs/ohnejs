import type { ConditionNode } from '../../../utils/index.ts';
import type { CollectionName } from '../../collections/known-collections.ts';
import type { LocaleCode } from '../../collections/known-locales.ts';
import type { Transaction } from '../../database/adapter.ts';
import type { Dialect } from '../../database/dialect.ts';
import type { CollectionQueryMeta } from '../metadata.ts';
import type { ProcessedScope, RecordWriteContext } from '../pipeline/run-record.ts';
import type { QueryRecord } from '../read/find.ts';
import type { ReachResolver } from '../wire/reach.ts';
import type { FieldErrors } from './errors.ts';
import type { LinkReach } from './references.ts';

import { isEmpty, isNull, isUndefined, uuidv7 } from '../../../utils/index.ts';
import { useDialect } from '../../database/use-database.ts';
import { ohneError } from '../../error/ohne-error.ts';
import { applyHook } from '../../hooks/apply-hook.ts';
import { useHooks } from '../../hooks/use-hooks.ts';
import { checkQueryLocale, effectiveLocale, queryLocales } from '../locale.ts';
import { isTranslatableEntry, queryMetadata } from '../metadata.ts';
import { runRecord } from '../pipeline/run-record.ts';
import { readRows } from '../read/find.ts';
import { commitEffects } from './committed.ts';
import { emptyCompanionPlan, splitColumns, upsertCompanion } from './companion.ts';
import { applyReconcile, createPlan } from './reconcile.ts';
import { checkReferences } from './references.ts';
import { runWrite } from './run-write.ts';
import {
  checkChildUnique,
  checkCompositeUnique,
  checkUnique,
  indexOverflowErrors,
  uniqueRaceErrors,
} from './unique.ts';
import { attemptUpdate } from './update.ts';

/**
 * The outcome of a create: the re-read record, or the field failures that stopped it.
 * A failure carries `locale` when a create with `locales` failed at one of them.
 */
export type CreateOutcome =
  | { ok: true; record: QueryRecord }
  | { ok: false; errors: FieldErrors; locale?: LocaleCode };

/**
 * The context a mutation hook fires with once a record reaches its final, re-read state.
 */
export interface RecordMutateContext {
  /**
   * The collection that was written, by name.
   */
  collection: CollectionName;

  /**
   * The open write transaction, so a callback writes atomically with the change.
   */
  tx: Transaction;

  /**
   * The effective locale the record was read at.
   */
  locale: LocaleCode;
}

declare module 'ohnejs' {
  interface Hooks {
    /**
     * Filters the field errors of a create or update after coercion, before any precheck or write.
     * Fires inside the transaction, with the coerced values in `scope.values`.
     * Add cross-field or cross-collection failures the per-field validator cannot express.
     * The threaded value is the errors so far: spread it to add keys, or return your own to replace.
     * A non-empty result aborts the write as `{ ok: false, errors }`, and nothing is written.
     * Returning `undefined` or an empty map lets the write proceed.
     * A create with `locales` fires it once more per locale, as an `update` at that locale.
     * The `ctx` carries the `collection`, the `operation`, the `locale`, and the open `tx`.
     */
    'record:validate': (
      errors: FieldErrors,
      scope: ProcessedScope,
      ctx: RecordWriteContext,
    ) => FieldErrors | void | Promise<FieldErrors | void>;

    /**
     * Filters a freshly created record, re-read in its final state, just before the create returns.
     * Fires inside the transaction, so a search-index, revision, or audit write commits atomically with it.
     * A create with `locales` fires it once, after every locale is written.
     * Return a replacement record to reshape what the caller receives, or return nothing to leave it.
     * The `ctx` carries the `collection`, the open `tx`, and the effective `locale`.
     */
    'record:after-create': (
      record: QueryRecord,
      ctx: RecordMutateContext,
    ) => QueryRecord | void | Promise<QueryRecord | void>;
  }
}

/**
 * Creates one record and returns it, or the field failures.
 *
 * Runs the whole in-transaction order: validate, precheck uniqueness, prove references, insert, re-read.
 * Opens an `immediate` write transaction unless `joinedTx` supplies one, in which case the caller holds it.
 * `locale` is the chain's explicit choice or `null`; translatable values land on the effective locale.
 * `unscoped` reads the record back past the `query:filter` hook, for framework bookkeeping.
 * `linkResolver` narrows every link the input provides to what it reaches, as `linkReach` states.
 * `locales` writes each other locale's translatable values after the insert, in the configured order.
 * Each one runs the update pipeline at its locale, links judged by `linkResolver` alike.
 * The record is new, so no update hook fires, and `record:after-create` fires once every locale is written.
 * A failure at one of them names it as `locale`, and the whole create unwinds.
 * A validation or precheck failure returns `{ ok: false }` and persists nothing.
 * A constraint race is classified; a busy database surfaces as a retryable `busyError`, an HTTP `503`.
 */
export async function runCreate(
  collection: string,
  input: Record<string, unknown>,
  locale: string | null,
  joinedTx?: Transaction,
  unscoped = false,
  linkResolver: ReachResolver | null = null,
  locales: Readonly<Record<string, Record<string, unknown>>> = {},
): Promise<CreateOutcome> {
  const meta = queryMetadata(collection);
  const dialect = useDialect();
  const fills = localeFills(meta, effectiveLocale(locale), locales);
  const writing: { locale?: LocaleCode } = {};
  const outcome = await runWrite<CreateOutcome>(
    dialect,
    joinedTx,
    (o) => !o.ok,
    (tx) => attemptCreate(tx, meta, dialect, input, locale, unscoped, linkResolver, fills, writing),
    (error) => {
      const at = isUndefined(writing.locale) ? {} : { locale: writing.locale };
      if (dialect.isUniqueViolation(error)) {
        const errors = uniqueRaceErrors(meta, dialect.indexViolationTarget(error));
        return { ok: false, errors, ...at };
      }
      if (dialect.isIndexOverflow(error)) {
        const errors = indexOverflowErrors(meta, dialect.indexViolationTarget(error));
        return { ok: false, errors, ...at };
      }
      if (dialect.isForeignKeyViolation(error)) {
        return { ok: false, errors: { '': 'validation.invalidReference' }, ...at };
      }
      return undefined;
    },
  );
  if (outcome.ok) {
    await commitEffects(
      {
        collection: collection as CollectionName,
        operation: 'create',
        uuids: [outcome.record.UUID as string],
      },
      joinedTx,
    );
  }
  return outcome;
}

/**
 * Checks a create's `locales` and orders them as `collections.locales` does, dropping empty ones.
 * An empty entry would write nothing yet bump `_updatedAt`, so it never runs.
 * Misuse throws:
 *
 * - `locales` on a collection with no translatable field.
 * - A locale outside `collections.locales`, or the create's own locale.
 * - A field whose value every locale shares.
 */
function localeFills(
  meta: CollectionQueryMeta,
  base: string,
  locales: Readonly<Record<string, Record<string, unknown>>>,
): [LocaleCode, Record<string, unknown>][] {
  if (isEmpty(locales)) return [];
  if (meta.translatable !== true) {
    throw ohneError({
      title: `Cannot create \`${meta.collection}\` with \`locales\``,
      body: [
        `Collection \`${meta.collection}\` has no translatable field, so no value differs per locale.`,
      ],
    });
  }
  const given = new Map(
    Object.entries(locales).map(([code, fill]) => [checkQueryLocale(code), fill] as const),
  );
  if (given.has(base)) {
    throw ohneError({
      title: `\`locales\` repeats the create's own locale \`${base}\``,
      body: ['The input already writes that locale.', 'Move its values into the input.'],
    });
  }
  for (const [code, fill] of given) {
    for (const name of Object.keys(fill)) {
      const field = meta.fields[name];
      if (isUndefined(field) || isTranslatableEntry(field)) continue;
      throw ohneError({
        title: `\`locales.${code}.${name}\` is not translatable`,
        body: [`Every locale shares the value of \`${name}\`.`, 'Write it in the input instead.'],
      });
    }
  }
  return queryLocales()
    .locales.filter((code) => !isEmpty(given.get(code) ?? {}))
    .map((code) => [code as LocaleCode, given.get(code) as Record<string, unknown>]);
}

/**
 * The insert attempt inside the transaction, in the order `runCreate` lists.
 * `writing.locale` names the fill in flight, so a driver race inside it still reports its locale.
 */
async function attemptCreate(
  tx: Transaction,
  meta: CollectionQueryMeta,
  dialect: Dialect,
  input: Record<string, unknown>,
  locale: string | null,
  unscoped: boolean,
  linkResolver: ReachResolver | null,
  fills: readonly [LocaleCode, Record<string, unknown>][],
  writing: { locale?: LocaleCode },
): Promise<CreateOutcome> {
  const code = effectiveLocale(locale);
  const reach: LinkReach | undefined = isNull(linkResolver)
    ? undefined
    : { resolve: linkResolver, locale: code };
  const processed = await runRecord(meta, input, { operation: 'create', locale: code, tx, reach });
  if (!processed.ok) return { ok: false, errors: processed.errors };
  const scope = processed.scope;

  const validation = useHooks().get('record:validate');
  if (!isUndefined(validation) && validation.length > 0) {
    const errors = await applyHook('record:validate', {} as FieldErrors, scope, {
      collection: meta.collection as CollectionName,
      operation: 'create',
      locale: code as LocaleCode,
      tx,
    });
    if (!isEmpty(errors)) return { ok: false, errors };
  }

  const uniqueErrors = await checkUnique(tx, dialect, meta, scope.columns, code);
  if (!isEmpty(uniqueErrors)) return { ok: false, errors: uniqueErrors };

  const compositeUniqueErrors = await checkCompositeUnique(tx, dialect, meta, scope.columns, code);
  if (!isEmpty(compositeUniqueErrors)) return { ok: false, errors: compositeUniqueErrors };

  const childUniqueErrors = await checkChildUnique(tx, dialect, scope.uniqueProbes);
  if (!isEmpty(childUniqueErrors)) return { ok: false, errors: childUniqueErrors };

  const referenceErrors = await checkReferences(tx, dialect, scope.refs, reach);
  if (!isEmpty(referenceErrors)) return { ok: false, errors: referenceErrors };

  const uuid = uuidv7();
  const { main, companion } = splitColumns(meta.fields, scope.columns);
  const plan = createPlan(
    dialect,
    meta.table,
    meta.fields,
    uuid,
    { ...scope, columns: main },
    code,
  );
  await applyReconcile(tx, dialect, plan);
  if (!isUndefined(meta.companionTable)) {
    await upsertCompanion(tx, dialect, meta, companion, [uuid], code, emptyCompanionPlan());
  }

  const condition: ConditionNode = {
    kind: 'compare',
    path: ['UUID'],
    op: 'equalsTo',
    value: uuid,
    negated: false,
  };
  for (const [fillLocale, fill] of fills) {
    writing.locale = fillLocale;
    const filled = await attemptUpdate(
      tx,
      meta,
      dialect,
      fill,
      condition,
      fillLocale,
      true,
      linkResolver,
      true,
    );
    if (!filled.ok) return { ok: false, errors: filled.errors, locale: fillLocale };
  }
  delete writing.locale;

  const rows = await readRows({
    collection: meta.collection,
    condition,
    select: null,
    order: [],
    limit: 1,
    offset: null,
    populate: [],
    locale,
    access: null,
    wire: null,
    unscoped,
  });
  const record = rows[0];
  if (isUndefined(record)) {
    throw ohneError({
      title: `Read-back of a created \`${meta.collection}\` record found nothing`,
      body: [
        'The row was inserted, but reading it back returned no record.',
        'A `query:filter` or `query:records` hook hid it, or the read ran on another connection.',
      ],
    });
  }
  const finalize = useHooks().get('record:after-create');
  if (isUndefined(finalize) || finalize.length === 0) return { ok: true, record };
  return {
    ok: true,
    record: await applyHook('record:after-create', record, {
      collection: meta.collection as CollectionName,
      tx,
      locale: code as LocaleCode,
    }),
  };
}
