import type { Transaction } from '../../database/adapter.ts';
import type { LogicalType } from '../../database/dialect.ts';
import type { FieldOperation } from '../../fields/context.ts';
import type { CollectionQueryMeta, FieldQueryMeta } from '../metadata.ts';
import type { FieldErrors } from '../write/errors.ts';

import { isEmpty, isUndefined } from '../../../utils/index.ts';
import { finishComposite, prepareComposite } from './descend.ts';
import { finishScalar, prepareScalar } from './run-field.ts';

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
}

/**
 * One field's phase-A outcome: skipped, failed, or carrying a coerced value into phase B.
 */
export type Prepared = { skip: true } | { errors: FieldErrors } | { value: unknown };

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
   * Present only for a repeater item under an update, where it names the row to keep.
   */
  itemUUID?: string;

  /**
   * The column values by column name, each field-serialized; the dialect codec applies at bind time.
   */
  columns: Record<string, unknown>;

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

  const scope: ProcessedScope = {
    columns: {},
    relations: [],
    children: [],
    refs: [],
    uniqueProbes: [],
  };
  await Promise.all(
    names.map(async (name) => {
      const entry = prepared[name];
      if ('skip' in entry) return;
      if ('errors' in entry) {
        Object.assign(errors, entry.errors);
        return;
      }
      const meta = fields[name];
      const output = isScalarField(meta)
        ? await finishScalar(name, meta, entry.value, input, ctx)
        : await finishComposite(name, meta, entry.value, ctx, processScope);
      mergeOutput(scope, errors, output);
    }),
  );

  if (!isEmpty(errors)) return { ok: false, errors };
  return { ok: true, scope };
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
  };
  return processScope(collectionMeta.fields, input, ctx);
}
