import type { Transaction } from '../../database/adapter.ts';
import type { Dialect } from '../../database/dialect.ts';
import type { CollectionQueryMeta } from '../metadata.ts';
import type { QueryRecord } from '../read/find.ts';
import type { FieldErrors } from './errors.ts';

import { isEmpty, isUndefined, uuidv7 } from '../../../utils/index.ts';
import { useDatabase, useDialect } from '../../database/use-database.ts';
import { ohneError } from '../../error/ohne-error.ts';
import { effectiveLocale } from '../locale.ts';
import { queryMetadata } from '../metadata.ts';
import { runRecord } from '../pipeline/run-record.ts';
import { readRows } from '../read/find.ts';
import { busyError } from './busy.ts';
import { insertCompanion, insertScope, splitColumns } from './insert.ts';
import { checkReferences } from './references.ts';
import { withSavepoint } from './savepoint.ts';
import { checkChildUnique, checkCompositeUnique, checkUnique, uniqueRaceErrors } from './unique.ts';

/**
 * The outcome of a create: the re-read record, or the field failures that stopped it.
 */
export type CreateOutcome = { ok: true; record: QueryRecord } | { ok: false; errors: FieldErrors };

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
  const run = isUndefined(joinedTx)
    ? () =>
        useDatabase().transaction(
          (tx) => attemptCreate(tx, meta, dialect, input, locale),
          'immediate',
        )
    : () =>
        withSavepoint(
          joinedTx,
          (outcome) => !outcome.ok,
          () => attemptCreate(joinedTx, meta, dialect, input, locale),
        );
  try {
    return await run();
  } catch (error) {
    if (dialect.isBusy(error)) throw busyError(error);
    if (dialect.isUniqueViolation(error)) {
      return { ok: false, errors: uniqueRaceErrors(meta, dialect.uniqueViolationTarget(error)) };
    }
    if (dialect.isForeignKeyViolation(error)) {
      return { ok: false, errors: { '': 'validation.invalidReference' } };
    }
    throw error;
  }
}

/**
 * The insert attempt inside the transaction, ordered exactly as the plan pins.
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
  await insertScope(tx, dialect, meta.table, meta.fields, uuid, { ...scope, columns: main }, code);
  if (!isUndefined(meta.companionTable)) {
    await insertCompanion(tx, dialect, meta, uuid, companion, code);
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
  return { ok: true, record };
}
