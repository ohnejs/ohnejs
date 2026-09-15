import type { CollectionName } from '../../collections/known-collections.ts';
import type { Transaction } from '../../database/adapter.ts';
import type { LogicalType } from '../../database/dialect.ts';
import type { FieldOperation } from '../../fields/context.ts';
import type { CollectionQueryMeta, FieldQueryMeta } from '../metadata.ts';
import type { FieldErrors } from '../write/errors.ts';

import {
  evaluateCondition,
  isArray,
  isEmpty,
  isNull,
  isObject,
  isString,
  isUndefined,
} from '../../../utils/index.ts';
import { applyHook } from '../../hooks/apply-hook.ts';
import { useHooks } from '../../hooks/use-hooks.ts';
import { finishComposite, prepareComposite, runCompositeTiers } from './descend.ts';
import { defaultPath, finishScalar, isProvided, prepareScalar, writeContext } from './run-field.ts';
import { scopeValuesOf, whenResolver, type ScopeValues } from './when.ts';

/**
 * The write pipeline's per-record context, shared by the input filter and the record validator.
 */
export interface RecordWriteContext {
  /**
   * The collection being written, by name.
   */
  collection: CollectionName;

  /**
   * Whether the record is being created or updated.
   */
  operation: FieldOperation;

  /**
   * The open write transaction, so a callback reads or writes in the same atomic bracket.
   */
  tx: Transaction;
}

declare module 'ohnejs' {
  interface Hooks {
    /**
     * Filters the raw input of a create or update before the pipeline coerces it, inside the transaction.
     * Fires once per create or update call, however many records the update matches.
     * One site covers every caller, so a timestamps, tenant, or audit layer stamps input everywhere.
     * Return a replacement record, or mutate the passed object in place and return nothing.
     * The `ctx` carries the `collection`, the `operation`, and the open `tx`.
     */
    'record:before-change': (
      input: Record<string, unknown>,
      ctx: RecordWriteContext,
    ) => Record<string, unknown> | void | Promise<Record<string, unknown> | void>;
  }
}

/**
 * The pipeline's per-scope threading: where in the record tree it runs, and against which transaction.
 */
export interface ScopeContext {
  /**
   * Whether the record is being created or updated.
   */
  operation: FieldOperation;

  /**
   * The owning collection, by name.
   */
  collection: string;

  /**
   * The open write transaction.
   */
  tx: Transaction;

  /**
   * The scope's full path from the record root: `''` at the top, `sections[0]` inside a repeater item.
   */
  path: string;

  /**
   * The coerced values of every enclosing scope, root-first, so a `when` can climb with `../` or `/`.
   * Empty at the record root; each composite descent appends the parent scope's values.
   */
  ancestors: readonly ScopeValues[];

  /**
   * The scope's precomputed coerced view, set on a composite item descent; absent at the record root.
   * An absent subfield's key holds its already-resolved default, so a callback default runs once.
   * A nested composite's key holds its own precomputed view, reused instead of rebuilt.
   * A descent never inherits it: a child without its own view resolves its absent fields afresh.
   */
  snapshot?: Record<string, unknown>;
}

/**
 * One field's phase-A outcome: skipped, failed, or carrying a coerced value into phase B.
 * `provided` marks a caller-supplied composite value, so phase B runs its tiers; a default omits it.
 * `snapshot` is a provided composite's coerced, defaulted view, the value a sibling `when` reads.
 * The raw `value` still flows to phase B unchanged.
 */
export type Prepared =
  | { skip: true }
  | { errors: FieldErrors }
  | { value: unknown; provided?: true; snapshot?: unknown };

/**
 * A reference a write must prove exists before it commits: a `record` FK or a `records`/nested link.
 */
export interface RelationRef {
  /**
   * The referring field's dot-path, so a missing target errors at its exact location.
   */
  path: string;

  /**
   * The target collection, by name.
   */
  target: string;

  /**
   * The referenced row's `UUID`.
   */
  uuid: string;
}

/**
 * A table-wide `unique` child value a create must prove is free before it commits.
 * It carries its dot-path, so a collision - same-create or an existing row - errors at the exact field.
 */
export interface UniqueProbe {
  /**
   * The child table the value lands in.
   */
  table: string;

  /**
   * The column holding the value.
   */
  column: string;

  /**
   * The column's storage primitive, for serialization at probe time.
   */
  logicalType: LogicalType;

  /**
   * The value to prove unique, field-serialized.
   */
  value: unknown;

  /**
   * The value's dot-path from the record root.
   */
  path: string;
}

/**
 * A `records` write: the linked target `UUID`s in order, with the field's metadata for the junction.
 */
export interface ProcessedRelation {
  /**
   * The `records` field's metadata, carrying its junction table and inverse flag.
   */
  meta: FieldQueryMeta;

  /**
   * The linked target `UUID`s, in the caller's order.
   */
  uuids: string[];
}

/**
 * A composite write: the processed item scopes, one for an `object`, many for a `repeater`.
 */
export interface ProcessedChild {
  /**
   * The composite field's metadata, carrying its child table and subfields.
   */
  meta: FieldQueryMeta;

  /**
   * The field's dot-path from the record root, so an update keys a bad item at its exact location.
   */
  path: string;

  /**
   * The processed items, in order; an `object` holds at most one, and a cleared `object` holds none.
   */
  items: ProcessedScope[];
}

/**
 * One validated, serialized scope ready to write: its columns, relations, children, and references.
 */
export interface ProcessedScope {
  /**
   * A composite item's input `UUID`, correlating it to an existing child row on update; absent otherwise.
   * Present only for a repeater or blocks item under an update, where it names the row to keep.
   */
  itemUUID?: string;

  /**
   * A blocks item's block type, resolving its per-type table and subfields through `blockQueryMetadata`.
   * Present only on the item scopes of a `blocks` field's `ProcessedChild`.
   */
  blockType?: string;

  /**
   * The column values by column name, each field-serialized; the dialect codec applies at bind time.
   */
  columns: Record<string, unknown>;

  /**
   * The scope's coerced phase-A values by field name, the substrate a nested `when` resolves against.
   * Distinct from `columns`, which are field-serialized; a gate reads the pre-serialize domain value.
   */
  values: ScopeValues;

  /**
   * The default of each `when`-bearing subfield; nested update items only.
   * A column holds its field-serialized value; a relation its `UUID`s; a composite its item scopes.
   * When a subfield gates inactive for a matched record, the write substitutes this default.
   */
  gatedDefaults?: Record<string, unknown>;

  /**
   * The failures of gated defaults that did not resolve, keyed relative to this scope.
   * The executor fails the call with one only when a matched record actually needs that default.
   */
  gatedDefaultErrors?: FieldErrors;

  /**
   * The `records` writes this scope contributes.
   */
  relations: ProcessedRelation[];

  /**
   * The composite writes this scope contributes.
   */
  children: ProcessedChild[];

  /**
   * Every reference the scope and its descendants must prove exists.
   */
  refs: RelationRef[];

  /**
   * Every table-wide unique child value the scope and its descendants must prove is free.
   */
  uniqueProbes: UniqueProbe[];
}

/**
 * A field's phase-B contribution, merged into the scope, or its failures.
 */
export interface FieldOutput {
  /**
   * The field's failures, keyed by dot-path.
   */
  errors?: FieldErrors;

  /**
   * A column value the field writes.
   */
  column?: { name: string; value: unknown };

  /**
   * A `records` write the field contributes.
   */
  relation?: ProcessedRelation;

  /**
   * A composite write the field contributes.
   */
  child?: ProcessedChild;

  /**
   * References the field contributes to the existence probe.
   */
  refs?: RelationRef[];

  /**
   * Unique probes the field contributes to the child-uniqueness precheck.
   */
  uniqueProbes?: UniqueProbe[];
}

/**
 * The result of processing one scope: the write-ready scope, or the field failures.
 */
export type ProcessResult =
  | { ok: true; scope: ProcessedScope }
  | { ok: false; errors: FieldErrors };

/**
 * The result of the whole-record run: `processScope`'s outcome plus the effective input on success.
 * The effective input is the frozen post-hook copy, the object the scope was actually built from.
 */
export type RunRecordResult =
  | { ok: true; scope: ProcessedScope; input: Readonly<Record<string, unknown>> }
  | { ok: false; errors: FieldErrors };

/**
 * The scope processor, passed to the composite descent so it can recurse without a module cycle.
 */
export type ProcessScope = (
  fields: Record<string, FieldQueryMeta>,
  input: Readonly<Record<string, unknown>>,
  ctx: ScopeContext,
) => Promise<ProcessResult>;

/**
 * Whether a field stores through the scalar path: a plain column or a `record` foreign key.
 */
function isScalarField(meta: FieldQueryMeta): boolean {
  return meta.kind === 'column' || meta.kind === 'record';
}

/**
 * Processes one scope's fields through the two-phase pipeline, dispatching each field on its kind.
 *
 * Phase A runs every field's default path, null gate, and coerce.
 * A create gates each field on its `when` (step 3) between the phases, reading coerced siblings and ancestry.
 * An inactive field drops its value, `null` included, and takes the default path.
 * An update never gates here; its activation is per matched record, resolved by the executor.
 * Provided fields there validate once, whether active or not.
 * Phase B then validates and serializes each field in parallel, each owning its own error slice.
 * An unknown input key is rejected up front: writes are strict, and a silent drop hides a caller's typo.
 */
export async function processScope(
  fields: Record<string, FieldQueryMeta>,
  input: Readonly<Record<string, unknown>>,
  ctx: ScopeContext,
): Promise<ProcessResult> {
  const names = Object.keys(fields).filter((name) => !isUndefined(fields[name].fieldType));
  const errors: FieldErrors = Object.create(null);
  const settable = new Set(names);
  for (const key of Object.keys(input)) {
    if (!settable.has(key)) errors[key] = 'validation.unknownField';
  }

  const prepared: Record<string, Prepared> = {};
  await Promise.all(
    names.map(async (name) => {
      const meta = fields[name];
      prepared[name] = isScalarField(meta)
        ? await prepareScalar(name, meta, input, ctx)
        : await prepareComposite(name, meta, input, ctx);
    }),
  );

  const scopeValues = scopeValuesOf(names, prepared);
  const descentCtx: ScopeContext = { ...ctx, ancestors: [...ctx.ancestors, scopeValues] };
  const resolve =
    ctx.operation === 'create' && names.some((name) => !isUndefined(fields[name].when))
      ? whenResolver(scopeValues, ctx.ancestors)
      : undefined;
  const gated =
    ctx.operation === 'update' && ctx.path !== ''
      ? await gatedDefaultsOf(names, fields, input, ctx)
      : undefined;

  const scope: ProcessedScope = {
    columns: {},
    values: scopeValues,
    relations: [],
    children: [],
    refs: [],
    uniqueProbes: [],
    ...(isUndefined(gated) ? {} : { gatedDefaults: gated.defaults }),
    ...(isUndefined(gated) || isEmpty(gated.errors) ? {} : { gatedDefaultErrors: gated.errors }),
  };
  await Promise.all(
    names.map(async (name) => {
      const meta = fields[name];
      let entry = prepared[name];
      if (
        !isUndefined(resolve) &&
        !isUndefined(meta.when) &&
        !evaluateCondition(meta.when, resolve) &&
        isProvided(input, name)
      ) {
        entry = await defaultPath(name, meta, writeContext(name, meta, input, ctx));
      }
      if ('skip' in entry) return;
      let snapshot = 'snapshot' in entry ? entry.snapshot : undefined;
      if ('provided' in entry) {
        const raw = entry.value;
        entry = await runCompositeTiers(name, meta, entry.value, input, descentCtx);
        if (!('value' in entry) || entry.value !== raw) snapshot = undefined;
      }
      if ('errors' in entry) {
        Object.assign(errors, entry.errors);
        return;
      }
      const output = isScalarField(meta)
        ? await finishScalar(name, meta, entry.value, input, descentCtx)
        : await finishComposite(name, meta, entry.value, descentCtx, processScope, snapshot);
      mergeOutput(scope, errors, output);
    }),
  );

  if (!isEmpty(errors)) return { ok: false, errors };
  return { ok: true, scope };
}

/**
 * The stored default of every `when`-bearing subfield in a nested update item, with its failures.
 *
 * A gated subfield that turns inactive for a matched record takes this default, exactly as a create would.
 * A column default runs the same `finishScalar` path a create does, landing its serialized value.
 * A relation or composite default descends `finishComposite`, landing its `UUID`s or item scopes.
 * A default the tiers reject lands its failure in `errors` instead, keyed relative to this scope.
 * The executor fails the call with it only when some matched record actually needs that default.
 * A composite default's references and unique probes are not prechecked.
 * An escape classifies at its constraint.
 * The default is parent-independent, so it computes once here rather than per matched parent.
 */
async function gatedDefaultsOf(
  names: readonly string[],
  fields: Record<string, FieldQueryMeta>,
  input: Readonly<Record<string, unknown>>,
  ctx: ScopeContext,
): Promise<{ defaults: Record<string, unknown>; errors: FieldErrors } | undefined> {
  let result: { defaults: Record<string, unknown>; errors: FieldErrors } | undefined;
  for (const name of names) {
    const meta = fields[name];
    if (isUndefined(meta.when)) continue;
    const { defaults, errors } = (result ??= { defaults: {}, errors: {} });
    const prepared = await defaultPath(name, meta, writeContext(name, meta, input, ctx));
    if ('errors' in prepared) {
      Object.assign(errors, prepared.errors);
      continue;
    }
    if (!('value' in prepared)) continue;
    if (meta.kind === 'column' || meta.kind === 'record') {
      const output = await finishScalar(name, meta, prepared.value, input, ctx);
      if (!isUndefined(output.errors)) Object.assign(errors, output.errors);
      else if (!isUndefined(output.column)) defaults[name] = output.column.value;
      continue;
    }
    if (!isDefaultShaped(meta, prepared.value)) {
      errors[name] = 'validation.invalidValue';
      continue;
    }
    const output = await finishComposite(name, meta, prepared.value, ctx, processScope);
    if (!isUndefined(output.errors)) Object.assign(errors, output.errors);
    else defaults[name] = output.relation?.uuids ?? output.child?.items ?? [];
  }
  return result;
}

/**
 * Whether a composite default holds the shape `finishComposite` descends: its list, object, or null form.
 */
function isDefaultShaped(meta: FieldQueryMeta, value: unknown): boolean {
  if (meta.kind === 'childOne') return isNull(value) || isObject(value);
  if (!isArray(value)) return false;
  return meta.kind === 'records' ? value.every(isString) : value.every(isObject);
}

/**
 * Folds one field's output into the scope, or its errors into the error map.
 */
function mergeOutput(scope: ProcessedScope, errors: FieldErrors, output: FieldOutput): void {
  if (output.errors) Object.assign(errors, output.errors);
  if (output.column) scope.columns[output.column.name] = output.column.value;
  if (output.relation) scope.relations.push(output.relation);
  if (output.child) scope.children.push(output.child);
  if (output.refs) scope.refs.push(...output.refs);
  if (output.uniqueProbes) scope.uniqueProbes.push(...output.uniqueProbes);
}

/**
 * Runs the whole write pipeline for one record, returning its failures unresolved for the boundary.
 *
 * Every failure value is a `Message`: a key, a `{ key, params }` object, or a plain string.
 * The returned scope is write-ready: columns serialized, relations and children collected, refs gathered.
 * The input is copied shallowly and frozen, so a field callback cannot poison a sibling's read.
 * The caller's own object stays untouched.
 * A success carries that frozen copy as `input`, so the executor gates against what the scope read.
 */
export async function runRecord(
  collectionMeta: CollectionQueryMeta,
  input: Readonly<Record<string, unknown>>,
  options: { operation: FieldOperation; tx: Transaction },
): Promise<RunRecordResult> {
  const ctx: ScopeContext = {
    operation: options.operation,
    collection: collectionMeta.collection,
    tx: options.tx,
    path: '',
    ancestors: [],
  };
  const changeCtx: RecordWriteContext = {
    collection: collectionMeta.collection as CollectionName,
    operation: options.operation,
    tx: options.tx,
  };
  const callbacks = useHooks().get('record:before-change');
  const base =
    isUndefined(callbacks) || isEmpty(callbacks)
      ? { ...input }
      : await applyHook('record:before-change', { ...input }, changeCtx);
  const effective = Object.freeze(base);
  const result = await processScope(collectionMeta.fields, effective, ctx);
  return result.ok ? { ok: true, scope: result.scope, input: effective } : result;
}
