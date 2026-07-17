import type { Transaction } from '../../database/adapter.ts';
import type { LogicalType } from '../../database/dialect.ts';
import type { FieldOperation } from '../../fields/context.ts';
import type { CollectionQueryMeta, FieldQueryMeta } from '../metadata.ts';
import type { FieldErrors } from '../write/errors.ts';

import { evaluateCondition, isEmpty, isUndefined } from '../../../utils/index.ts';
import { finishComposite, prepareComposite, runCompositeTiers } from './descend.ts';
import { defaultPath, finishScalar, prepareScalar, writeContext } from './run-field.ts';
import { scopeValuesOf, whenResolver, type ScopeValues } from './when.ts';

/**
 * The pipeline's per-scope threading: where in the record tree it runs, and against which transaction.
 * A nested composite scope carries its own `path` and `input`, everything else inherited.
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
}

/**
 * One field's phase-A outcome: skipped, failed, or carrying a coerced value into phase B.
 * `provided` marks a caller-supplied composite value, so phase B runs its tiers; a default omits it.
 */
export type Prepared =
  | { skip: true }
  | { errors: FieldErrors }
  | { value: unknown; provided?: true };

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
   * The field-serialized default of each `when`-bearing column subfield; nested update items only.
   * When a subfield gates inactive for a matched record, the write substitutes this default.
   */
  gatedDefaults?: Record<string, unknown>;

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
  const gatedDefaults =
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
    ...(isUndefined(gatedDefaults) ? {} : { gatedDefaults }),
  };
  await Promise.all(
    names.map(async (name) => {
      const meta = fields[name];
      let entry = prepared[name];
      if (
        !isUndefined(resolve) &&
        !isUndefined(meta.when) &&
        !evaluateCondition(meta.when, resolve)
      ) {
        entry = await defaultPath(name, meta, writeContext(name, meta, input, ctx));
      }
      if ('skip' in entry) return;
      if ('provided' in entry)
        entry = await runCompositeTiers(name, meta, entry.value, input, descentCtx);
      if ('errors' in entry) {
        Object.assign(errors, entry.errors);
        return;
      }
      const output = isScalarField(meta)
        ? await finishScalar(name, meta, entry.value, input, descentCtx)
        : await finishComposite(name, meta, entry.value, descentCtx, processScope);
      mergeOutput(scope, errors, output);
    }),
  );

  if (!isEmpty(errors)) return { ok: false, errors };
  return { ok: true, scope };
}

/**
 * The stored default of every `when`-bearing column subfield in a nested update item.
 *
 * A gated subfield that turns inactive for a matched record takes this default, exactly as a create would.
 * The default runs through the same `finishScalar` path a create does - null short-circuit, tiers, serialize.
 * The reset value therefore equals what a create or an omitted subfield stores.
 * The default is parent-independent, so it computes once here rather than per matched parent in the executor.
 * Relations and composites default structurally (empty), so only column and `record` kinds appear here.
 */
async function gatedDefaultsOf(
  names: readonly string[],
  fields: Record<string, FieldQueryMeta>,
  input: Readonly<Record<string, unknown>>,
  ctx: ScopeContext,
): Promise<Record<string, unknown> | undefined> {
  let defaults: Record<string, unknown> | undefined;
  for (const name of names) {
    const meta = fields[name];
    if (isUndefined(meta.when) || (meta.kind !== 'column' && meta.kind !== 'record')) continue;
    const prepared = await defaultPath(name, meta, writeContext(name, meta, input, ctx));
    if (!('value' in prepared)) continue;
    const output = await finishScalar(name, meta, prepared.value, input, ctx);
    if (!isUndefined(output.column)) (defaults ??= {})[name] = output.column.value;
  }
  return defaults;
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
 * Every failure value is a `Message`: a key, a `[key, params]` tuple, or a plain string.
 * The returned scope is write-ready: columns serialized, relations and children collected, refs gathered.
 */
export async function runRecord(
  collectionMeta: CollectionQueryMeta,
  input: Readonly<Record<string, unknown>>,
  options: { operation: FieldOperation; tx: Transaction },
): Promise<ProcessResult> {
  const ctx: ScopeContext = {
    operation: options.operation,
    collection: collectionMeta.collection,
    tx: options.tx,
    path: '',
    ancestors: [],
  };
  return processScope(collectionMeta.fields, input, ctx);
}
