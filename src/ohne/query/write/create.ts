import type { CollectionName } from '../../collections/known-collections.ts';
import type { LocaleCode } from '../../collections/known-locales.ts';
import type { Transaction } from '../../database/adapter.ts';
import type { Dialect } from '../../database/dialect.ts';
import type { CollectionQueryMeta } from '../metadata.ts';
import type { ProcessedScope, RecordWriteContext } from '../pipeline/run-record.ts';
import type { QueryRecord } from '../read/find.ts';
import type { FieldErrors } from './errors.ts';

import { isEmpty, isUndefined, uuidv7 } from '../../../utils/index.ts';
import { useDialect } from '../../database/use-database.ts';
import { ohneError } from '../../error/ohne-error.ts';
import { applyHook } from '../../hooks/apply-hook.ts';
import { useHooks } from '../../hooks/use-hooks.ts';
import { effectiveLocale } from '../locale.ts';
import { queryMetadata } from '../metadata.ts';
import { runRecord } from '../pipeline/run-record.ts';
import { readRows } from '../read/find.ts';
import { commitEffects } from './committed.ts';
import { emptyCompanionPlan, splitColumns, upsertCompanion } from './companion.ts';
import { applyReconcile, createPlan } from './reconcile.ts';
import { checkReferences } from './references.ts';
import { runWrite } from './run-write.ts';
import { checkChildUnique, checkCompositeUnique, checkUnique, uniqueRaceErrors } from './unique.ts';

/**
 * The outcome of a create: the re-read record, or the field failures that stopped it.
 */
export type CreateOutcome = { ok: true; record: QueryRecord } | { ok: false; errors: FieldErrors };

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
     * The `ctx` carries the `collection`, the `operation`, and the open `tx`.
     */
    'record:validate': (
      errors: FieldErrors,
      scope: ProcessedScope,
      ctx: RecordWriteContext,
    ) => FieldErrors | void | Promise<FieldErrors | void>;

    /**
     * Filters a freshly created record, re-read in its final state, just before the create returns.
     * Fires inside the transaction, so a search-index, revision, or audit write commits atomically with it.
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
 * A validation or precheck failure returns `{ ok: false }` and writes nothing.
 * A constraint race is classified; a busy database surfaces as a retryable `busyError`, an HTTP `503`.
 */
export async function runCreate(
  collection: string,
  input: Record<string, unknown>,
  locale: string | null,
  joinedTx?: Transaction,
): Promise<CreateOutcome> {
  const meta = queryMetadata(collection);
  const dialect = useDialect();
  const outcome = await runWrite<CreateOutcome>(
    dialect,
    joinedTx,
    (o) => !o.ok,
    (tx) => attemptCreate(tx, meta, dialect, input, locale),
    (error) => {
      if (dialect.isUniqueViolation(error)) {
        return { ok: false, errors: uniqueRaceErrors(meta, dialect.uniqueViolationTarget(error)) };
      }
      if (dialect.isForeignKeyViolation(error)) {
        return { ok: false, errors: { '': 'validation.invalidReference' } };
      }
      return undefined;
    },
  );
  if (outcome.ok && isUndefined(joinedTx)) {
    await commitEffects({
      collection: collection as CollectionName,
      operation: 'create',
      uuids: [outcome.record.UUID as string],
    });
  }
  return outcome;
}

/**
 * The insert attempt inside the transaction, in the order `runCreate` lists.
 */
async function attemptCreate(
  tx: Transaction,
  meta: CollectionQueryMeta,
  dialect: Dialect,
  input: Record<string, unknown>,
  locale: string | null,
): Promise<CreateOutcome> {
  const processed = await runRecord(meta, input, { operation: 'create', tx });
  if (!processed.ok) return { ok: false, errors: processed.errors };
  const scope = processed.scope;
  const code = effectiveLocale(locale);

  const validation = useHooks().get('record:validate');
  if (!isUndefined(validation) && validation.length > 0) {
    const errors = await applyHook('record:validate', {} as FieldErrors, scope, {
      collection: meta.collection as CollectionName,
      operation: 'create',
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

  const referenceErrors = await checkReferences(tx, dialect, scope.refs);
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

  const rows = await readRows({
    collection: meta.collection,
    condition: { kind: 'compare', path: ['UUID'], op: 'equalsTo', value: uuid, negated: false },
    select: null,
    order: [],
    limit: 1,
    offset: null,
    populate: [],
    locale,
    wire: null,
  });
  const record = rows[0];
  if (isUndefined(record)) {
    throw ohneError({
      title: `Read-back of a created \`${meta.collection}\` record found nothing`,
      body: [
        'The row was inserted, but reading it back returned no record.',
        'The read path is likely on a different connection than the write transaction.',
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
