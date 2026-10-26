import type { Transaction } from '../database/adapter.ts';
import type { LogicalType } from '../database/dialect.ts';
import type { FieldOperation } from '../fields/context.ts';
import type { FieldQueryMeta } from './metadata.ts';
import type { Prepared, ScopeContext } from './pipeline/run-record.ts';

import {
  hasKey,
  isArray,
  isNull,
  isObject,
  isString,
  isUndefined,
  omit,
  uuidv7,
} from '../../utils/index.ts';
import { useDatabase, useDialect } from '../database/use-database.ts';
import { checkQueryLocale, effectiveLocale } from './locale.ts';
import { blockQueryMetadata, queryMetadata } from './metadata.ts';
import { runCompositeTiers } from './pipeline/descend.ts';
import { prefixPath } from './pipeline/prefix-errors.ts';
import { finishScalar } from './pipeline/run-field.ts';
import { prepareScope } from './pipeline/run-record.ts';
import { deserializeColumn } from './read/hydrate.ts';
import { linkReachable } from './write/references.ts';
import { withSavepoint } from './write/savepoint.ts';

/**
 * How `fillDefaults` runs: which write it mirrors, in which locale, and in which transaction.
 */
export interface FillDefaultsOptions {
  /**
   * The write whose stored shape to mirror.
   * An `update` leaves omitted top-level fields out and never gates the top level.
   * The update itself resolves both against the stored record.
   */
  operation: FieldOperation;

  /**
   * The locale the defaults resolve in, checked against `collections.locales`.
   * Omitted means the default locale.
   */
  locale?: string;

  /**
   * The open transaction to run in.
   * Pass it from inside a transaction: the connection runs one at a time, so a second would wait forever.
   * Omitted, it opens its own.
   */
  tx?: Transaction;
}

/**
 * Fills the fields a write would default, returning values in the shape a read gives back.
 * Each omitted field resolves as a create resolves it: its default, the tiers, and its `when` gate.
 * Every composite item and block instance fills whole under either operation.
 * An item without a `UUID` gets a fresh one.
 * Provided values stay as given, unsanitized, except an inactive one, which the gate replaces as writes do.
 * A field with nothing a write could store, like a required one without a default, stays absent.
 * A `readable: false` field is never returned.
 *
 * Callback defaults run in a savepoint that always rolls back, so nothing they write persists.
 * `record:before-change` never fires, and references and uniqueness go unchecked.
 * Under an update, a nested `when` that climbs to an omitted top-level field reads it as absent.
 * A translation an update would create takes its companion defaults, which an update fill leaves out.
 */
export async function fillDefaults(
  collection: string,
  values: Readonly<Record<string, unknown>>,
  options: FillDefaultsOptions,
): Promise<Record<string, unknown>> {
  const fields = queryMetadata(collection).fields;
  const locale = isUndefined(options.locale)
    ? effectiveLocale(null)
    : checkQueryLocale(options.locale);
  const run = (tx: Transaction): Promise<Record<string, unknown>> =>
    withSavepoint(
      tx,
      () => true,
      () =>
        fillScope(fields, Object.freeze({ ...values }), {
          operation: options.operation,
          collection,
          locale,
          tx,
          path: '',
          ancestors: [],
          reachable: linkReachable(),
        }),
    );
  return isUndefined(options.tx) ? useDatabase().transaction(run) : run(options.tx);
}

/**
 * Fills one scope: its settable fields in declaration order, then the keys it does not declare, as given.
 * Every scope gates except the top of an update, which the executor gates against the stored record.
 */
async function fillScope(
  fields: Record<string, FieldQueryMeta>,
  input: Readonly<Record<string, unknown>>,
  ctx: ScopeContext,
): Promise<Record<string, unknown>> {
  const gate = ctx.operation === 'create' || ctx.path !== '';
  const { entries, values } = await prepareScope(fields, input, ctx, gate);
  const inner: ScopeContext = { ...ctx, ancestors: [...ctx.ancestors, values] };
  const filled: Record<string, unknown> = {};
  await Promise.all(
    Object.entries(entries).map(async ([name, entry]) => {
      const meta = fields[name];
      if (meta.readable === false || !('value' in entry)) return;
      const value = await fillField(name, meta, entry, input, inner);
      if (!isUndefined(value)) filled[name] = value;
    }),
  );
  const out: Record<string, unknown> = {};
  for (const [name, meta] of Object.entries(fields)) {
    if (meta.readable === false) continue;
    if (hasKey(filled, name)) out[name] = filled[name];
    else if (isUndefined(meta.fieldType) && hasKey(input, name)) out[name] = input[name];
  }
  for (const key of Object.keys(input)) if (!hasKey(fields, key)) out[key] = input[key];
  return out;
}

/**
 * One field's read-shaped value, or `undefined` when its default fails the tiers.
 * A provided scalar returns as given; a provided composite skips its tiers and descends.
 */
async function fillField(
  name: string,
  meta: FieldQueryMeta,
  entry: Extract<Prepared, { value: unknown }>,
  input: Readonly<Record<string, unknown>>,
  ctx: ScopeContext,
): Promise<unknown> {
  const scalar = meta.kind === 'column' || meta.kind === 'record';
  if ('provided' in entry) {
    return scalar ? input[name] : descend(name, meta, entry.value, ctx, entry.snapshot);
  }
  const trusted = 'trusted' in entry;
  if (scalar) {
    const output = await finishScalar(name, meta, entry.value, input, ctx, trusted);
    return isUndefined(output.column) ? undefined : readColumn(name, meta, output.column.value);
  }
  if (trusted || isNull(entry.value)) return descend(name, meta, entry.value, ctx);
  const tiered = await runCompositeTiers(name, meta, entry.value, input, ctx);
  return 'errors' in tiered ? undefined : descend(name, meta, tiered.value, ctx);
}

/**
 * A serialized column value as a read returns it: the dialect codec round trip, then `deserialize`.
 */
async function readColumn(name: string, meta: FieldQueryMeta, stored: unknown): Promise<unknown> {
  if (isNull(stored)) return null;
  const dialect = useDialect();
  const bound = dialect.serialize(meta.logicalType as LogicalType, stored);
  return deserializeColumn(name, meta, dialect, bound);
}

/**
 * Fills a composite's items, each in its own scope.
 * A block outside the field's `allow`, or any malformed item, passes through as given.
 */
async function descend(
  name: string,
  meta: FieldQueryMeta,
  value: unknown,
  ctx: ScopeContext,
  snapshot?: unknown,
): Promise<unknown> {
  const base = omit(ctx, ['snapshot']);
  const path = ctx.path === '' ? name : prefixPath(ctx.path, name);
  const subfields = meta.subfields as Record<string, FieldQueryMeta>;
  if (meta.kind === 'childOne' && isObject(value)) {
    return fillItem(subfields, value, { ...base, path }, snapshot);
  }
  if (meta.kind === 'childMany' && isArray(value)) {
    return Promise.all(
      value.map((item, index) =>
        isObject(item)
          ? fillItem(subfields, item, { ...base, path: `${path}[${index}]` }, snapshot, index)
          : item,
      ),
    );
  }
  if (meta.kind === 'blocks' && isArray(value)) {
    const allow = meta.allow as readonly string[];
    return Promise.all(
      value.map(async (item, index) => {
        if (!isObject(item) || !isString(item.block) || !allow.includes(item.block)) return item;
        if (!isObject(item.fields)) return item;
        const fields = await fillScope(blockQueryMetadata(item.block).fields, item.fields, {
          ...base,
          path: `${path}[${index}].fields`,
        });
        return { block: item.block, UUID: itemUUID(item), fields };
      }),
    );
  }
  return value;
}

/**
 * Fills one composite item without its `UUID`, which a write never passes to a field.
 * `snapshot` is the field's phase-A view; a repeater's item takes its slice at `index`.
 */
async function fillItem(
  subfields: Record<string, FieldQueryMeta>,
  item: Record<string, unknown>,
  ctx: ScopeContext,
  snapshot: unknown,
  index?: number,
): Promise<Record<string, unknown>> {
  const view = isUndefined(index) ? snapshot : isArray(snapshot) ? snapshot[index] : undefined;
  const filled = await fillScope(subfields, omit(item, ['UUID']), {
    ...ctx,
    ...(isObject(view) ? { snapshot: view as Record<string, unknown> } : {}),
  });
  return { UUID: itemUUID(item), ...filled };
}

/**
 * The item's own `UUID` when it carries one, else a fresh one.
 */
function itemUUID(item: Record<string, unknown>): string {
  return isString(item.UUID) ? item.UUID : uuidv7();
}
