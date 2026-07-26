import type { ConditionNode } from '../../../utils/index.ts';
import type { CollectionName } from '../../collections/known-collections.ts';
import type { LocaleCode } from '../../collections/known-locales.ts';
import type { SQLValue, Transaction } from '../../database/adapter.ts';
import type { Dialect, LogicalType } from '../../database/dialect.ts';
import type { CollectionQueryMeta, FieldQueryMeta } from '../metadata.ts';
import type { ProcessedChild, ProcessedScope, UniqueProbe } from '../pipeline/run-record.ts';
import type { ScopeValues } from '../pipeline/when.ts';
import type { QueryRecord } from '../read/find.ts';
import type { RecordMutateContext } from './create.ts';
import type { FieldErrors } from './errors.ts';
import type { ReconcileTarget } from './reconcile.ts';

import {
  chunk,
  evaluateCondition,
  groupBy,
  isEmpty,
  isNull,
  isUndefined,
} from '../../../utils/index.ts';
import { useDialect } from '../../database/use-database.ts';
import { applyHook } from '../../hooks/apply-hook.ts';
import { useHooks } from '../../hooks/use-hooks.ts';
import { effectiveLocale } from '../locale.ts';
import { blockQueryMetadata, queryMetadata } from '../metadata.ts';
import { prefixPath } from '../pipeline/prefix-errors.ts';
import { runRecord } from '../pipeline/run-record.ts';
import { whenResolver } from '../pipeline/when.ts';
import { readRows } from '../read/find.ts';
import { compileFrom } from '../sql/from.ts';
import { compileWhere } from '../sql/where.ts';
import {
  activeScope,
  hasNestedGates,
  isEmptyScope,
  itemSubfields,
  partitionActivation,
  whenGates,
  type WhenGate,
} from './activation.ts';
import { blockInstancesUnder } from './blocks.ts';
import { commitEffects } from './committed.ts';
import { materializeFailure, planCompanion, splitColumns, upsertCompanion } from './companion.ts';
import { applyReconcile, columnTypes, planReconcile } from './reconcile.ts';
import { checkReferences } from './references.ts';
import { runWrite } from './run-write.ts';
import { checkChildUnique, checkCompositeUnique, checkUnique, uniqueRaceErrors } from './unique.ts';

/**
 * The outcome of an update: every matched record re-read in its final state, or the field failures.
 */
export type UpdateOutcome =
  | { ok: true; records: QueryRecord[] }
  | { ok: false; errors: FieldErrors };

/**
 * The context the row-condition filter fires with before a write resolves its matched set.
 */
export interface RecordConditionContext {
  /**
   * The collection being written, by name.
   */
  collection: CollectionName;

  /**
   * Whether the condition scopes an update or a delete.
   */
  operation: 'update' | 'delete';
}

declare module 'ohne' {
  interface Hooks {
    /**
     * Runs for each record an update touched, re-read in its final state, inside the transaction.
     * Fires once per matched record, on both the plain and the gated path, so it is genuinely per-row.
     * Use it for a per-record atomic effect - a search-index row, a revision - written on the same `tx`.
     * An action: its return is ignored, and the record is passed through unchanged.
     * The `ctx` carries the `collection`, the open `tx`, and the effective `locale`.
     */
    'record:after-update': (record: QueryRecord, ctx: RecordMutateContext) => void | Promise<void>;

    /**
     * Filters the `WHERE` condition of an update or delete before it resolves which rows are touched.
     * Fires once at the terminal's top, outside the transaction, before the matched set compiles.
     * Force-scope the write - a tenant filter, a soft-delete guard - by returning a narrowed condition.
     * Return a replacement `ConditionNode`, or return nothing to leave the caller's condition as is.
     * The `ctx` carries the `collection` and whether this is an `update` or a `delete`.
     */
    'record:condition': (
      condition: ConditionNode,
      ctx: RecordConditionContext,
    ) => ConditionNode | void | Promise<ConditionNode | void>;
  }
}

/**
 * Applies the `record:condition` filter to a write's condition, scoping which rows it touches.
 * Returns the condition unchanged when nothing subscribes, so the common write pays one lookup.
 */
export async function scopeCondition(
  collection: string,
  condition: ConditionNode,
  operation: 'update' | 'delete',
): Promise<ConditionNode> {
  const callbacks = useHooks().get('record:condition');
  if (isUndefined(callbacks) || callbacks.length === 0) return condition;
  return applyHook('record:condition', condition, {
    collection: collection as CollectionName,
    operation,
  });
}

/**
 * Runs the per-record `record:after-update` effect for each matched record, skipping when unused.
 * The subscriber check gates once, so an update with no subscriber pays a single lookup, not per row.
 */
async function afterUpdate(
  collection: string,
  records: QueryRecord[],
  tx: Transaction,
  locale: string,
): Promise<QueryRecord[]> {
  const callbacks = useHooks().get('record:after-update');
  if (isUndefined(callbacks) || callbacks.length === 0) return records;
  for (const record of records) {
    await applyHook('record:after-update', record, {
      collection: collection as CollectionName,
      tx,
      locale: locale as LocaleCode,
    });
  }
  return records;
}

/**
 * Updates every record the condition matches and returns them re-read, or the field failures.
 *
 * The pipeline runs once in `'update'` mode: only provided fields validate, and a field error stops the call.
 * The matched set resolves inside the transaction, then every derived write applies per matched record.
 * `locale` is the chain's explicit choice or `null`; translatable values land on the effective locale.
 * They upsert each matched record's companion row.
 * A missing row materializes, its unwritten companion columns filled through the default path.
 * Uniqueness prechecks exclude the matched rows, so a kept value never collides with its own record.
 * The returned records are all matched rows, untouched empty inputs included, in their final state.
 */
export async function runUpdate(
  collection: string,
  input: Record<string, unknown>,
  condition: ConditionNode,
  locale: string | null,
  joinedTx?: Transaction,
): Promise<UpdateOutcome> {
  const meta = queryMetadata(collection);
  const dialect = useDialect();
  const scoped = await scopeCondition(collection, condition, 'update');
  const outcome = await runWrite<UpdateOutcome>(
    dialect,
    joinedTx,
    (o) => !o.ok,
    (tx) => attemptUpdate(tx, meta, dialect, input, scoped, locale),
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
      operation: 'update',
      uuids: outcome.records.map((record) => record.UUID as string),
    });
  }
  return outcome;
}

/**
 * The update attempt inside the transaction: validate, resolve the matched set, precheck, then write.
 * Every precheck returns `{ ok: false }` before any write, so a failure leaves the database untouched.
 * An ungated update writes the whole scope everywhere; a gated one partitions activation first.
 */
async function attemptUpdate(
  tx: Transaction,
  meta: CollectionQueryMeta,
  dialect: Dialect,
  input: Record<string, unknown>,
  condition: ConditionNode,
  locale: string | null,
): Promise<UpdateOutcome> {
  const processed = await runRecord(meta, input, { operation: 'update', tx });
  if (!processed.ok) return { ok: false, errors: processed.errors };
  const scope = processed.scope;
  const code = effectiveLocale(locale);

  const validation = useHooks().get('record:validate');
  if (!isUndefined(validation) && validation.length > 0) {
    const errors = await applyHook('record:validate', {} as FieldErrors, scope, {
      collection: meta.collection as CollectionName,
      operation: 'update',
      tx,
    });
    if (!isEmpty(errors)) return { ok: false, errors };
  }

  const matched = await matchedUUIDs(tx, dialect, meta, condition, code);
  if (matched.length === 0) return { ok: true, records: [] };

  const gates = whenGates(meta.fields, input, scope);
  if (gates.length === 0 && !hasNestedGates(scope)) {
    return attemptPlainUpdate(tx, meta, dialect, scope, matched, code, locale);
  }
  return attemptGatedUpdate(tx, meta, dialect, scope, gates, matched, code, locale);
}

/**
 * The ungated path: every matched record takes the whole scope, so the scope is its own precheck union.
 * The reconcile plan reads existing derived rows once, correlates, and diffs before anything writes.
 */
async function attemptPlainUpdate(
  tx: Transaction,
  meta: CollectionQueryMeta,
  dialect: Dialect,
  scope: ProcessedScope,
  matched: readonly string[],
  code: string,
  locale: string | null,
): Promise<UpdateOutcome> {
  if (matched.length > 1 && scope.uniqueProbes.length > 0) {
    return { ok: false, errors: fannedErrors(scope.uniqueProbes) };
  }

  const uniqueErrors = await checkUnique(tx, dialect, meta, scope.columns, code, matched);
  if (!isEmpty(uniqueErrors)) return { ok: false, errors: uniqueErrors };

  const compositeUniqueErrors = await checkCompositeUnique(
    tx,
    dialect,
    meta,
    scope.columns,
    code,
    matched,
  );
  if (!isEmpty(compositeUniqueErrors)) return { ok: false, errors: compositeUniqueErrors };

  const excludeChildUUIDs =
    scope.uniqueProbes.length === 0
      ? []
      : await subtreeChildUUIDs(tx, dialect, meta.fields, matched, code);
  const childUniqueErrors = await checkChildUnique(
    tx,
    dialect,
    scope.uniqueProbes,
    excludeChildUUIDs,
  );
  if (!isEmpty(childUniqueErrors)) return { ok: false, errors: childUniqueErrors };

  const referenceErrors = await checkReferences(tx, dialect, scope.refs);
  if (!isEmpty(referenceErrors)) return { ok: false, errors: referenceErrors };

  const plan = await planReconcile(
    tx,
    dialect,
    matched.map((uuid) => ({ uuid, scope, ancestry: null })),
    code,
  );
  if (!isEmpty(plan.errors)) return { ok: false, errors: plan.errors };

  const companionPlan = await planCompanion(tx, dialect, meta, scope, matched, code);
  const { main, companion } = splitColumns(meta.fields, scope.columns);
  const failure = materializeFailure(companionPlan, companion, matched);
  if (!isNull(failure)) return { ok: false, errors: failure };
  await updateColumns(tx, dialect, meta.table, meta.fields, main, matched);
  if (!isEmpty(companion)) {
    await upsertCompanion(tx, dialect, meta, companion, matched, code, companionPlan);
  }
  await applyReconcile(tx, dialect, plan);

  return {
    ok: true,
    records: await afterUpdate(
      meta.collection,
      await readMatched(meta.collection, matched, locale),
      tx,
      code,
    ),
  };
}

/**
 * The gated path: partition activation first, then precheck the union of what the groups write.
 *
 * Top-level fields partition the matched records by signature, dropping each inactive gate's parts.
 * A record whose whole top-level signature is inactive is untouched, with no `_updatedAt` bump.
 * Each record's overlay is its stored shape under `scope.values`, the substrate a create's gates read.
 * A nested `when` reaching the root therefore reads that record's stored state.
 *
 * A field inactive for every matched record is not written, so it is not prechecked either.
 * A fully-inactive gated `unique` or `record` field can therefore never reject a valid update.
 * Unique columns probe with rewriter-exact exclusions: only rows that rewrite a column free theirs.
 * Child probes exclude only the rewriting records' subtrees.
 * A kept row under an inactive gate therefore still collides cleanly in the precheck.
 * The reconcile plan targets each record with its group's scope.
 * Correlation and the diff then see exactly the rows each record rewrites.
 * The gated-reset pre-pass then rejects any deactivation needing a failing default, before writes.
 */
async function attemptGatedUpdate(
  tx: Transaction,
  meta: CollectionQueryMeta,
  dialect: Dialect,
  scope: ProcessedScope,
  gates: readonly WhenGate[],
  matched: readonly string[],
  code: string,
  locale: string | null,
): Promise<UpdateOutcome> {
  const records = await readMatched(meta.collection, matched, locale);
  const overlays = new Map(
    records.map((record) => [record.UUID as string, { ...record, ...scope.values }]),
  );
  const groups = partitionActivation(records, gates, scope.values);
  const activeAnywhere = new Set(
    gates
      .filter((gate) => groups.some((group) => group.active.has(gate.name)))
      .map((gate) => gate.name),
  );
  const union = activeScope(scope, gates, activeAnywhere);
  const rewriters = (name: string | undefined): readonly string[] => {
    if (isUndefined(name) || !gates.some((gate) => gate.name === name)) return matched;
    return groups.filter((group) => group.active.has(name)).flatMap((group) => group.uuids);
  };

  const probeFields = groupBy(union.uniqueProbes, (probe) => headSegment(probe.path));
  for (const [name, probes] of Object.entries(probeFields)) {
    if (!isUndefined(probes) && rewriters(name).length > 1) {
      return { ok: false, errors: fannedErrors(probes) };
    }
  }

  const exclusions = new Map<
    string,
    { columns: Record<string, unknown>; exclude: readonly string[] }
  >();
  for (const [column, value] of Object.entries(union.columns)) {
    const gate = gates.find((candidate) => candidate.column === column);
    const exclude = rewriters(gate?.name);
    const entry = exclusions.get(exclude.join(' ')) ?? { columns: {}, exclude };
    entry.columns[column] = value;
    exclusions.set(exclude.join(' '), entry);
  }
  for (const { columns, exclude } of exclusions.values()) {
    const uniqueErrors = await checkUnique(tx, dialect, meta, columns, code, exclude);
    if (!isEmpty(uniqueErrors)) return { ok: false, errors: uniqueErrors };
  }

  const compositeUniqueErrors = await checkCompositeUnique(
    tx,
    dialect,
    meta,
    union.columns,
    code,
    matched,
  );
  if (!isEmpty(compositeUniqueErrors)) return { ok: false, errors: compositeUniqueErrors };

  for (const [name, probes] of Object.entries(probeFields)) {
    if (isUndefined(probes)) continue;
    const exclude = await subtreeChildUUIDs(
      tx,
      dialect,
      { [name]: meta.fields[name] },
      rewriters(name),
      code,
    );
    const childUniqueErrors = await checkChildUnique(tx, dialect, probes, exclude);
    if (!isEmpty(childUniqueErrors)) return { ok: false, errors: childUniqueErrors };
  }

  const referenceErrors = await checkReferences(tx, dialect, union.refs);
  if (!isEmpty(referenceErrors)) return { ok: false, errors: referenceErrors };

  const writes: {
    groupScope: ProcessedScope;
    uuids: readonly string[];
  }[] = [];
  const targets: ReconcileTarget[] = [];
  for (const group of groups) {
    const groupScope = activeScope(scope, gates, group.active);
    if (isEmptyScope(groupScope)) continue;
    writes.push({ groupScope, uuids: group.uuids });
    for (const uuid of group.uuids) {
      targets.push({ uuid, scope: groupScope, ancestry: [overlays.get(uuid) as ScopeValues] });
    }
  }
  const plan = await planReconcile(tx, dialect, targets, code);
  if (!isEmpty(plan.errors)) return { ok: false, errors: plan.errors };

  const companionPlan = await planCompanion(tx, dialect, meta, scope, matched, code);
  for (const record of records) {
    const ancestry = [overlays.get(record.UUID as string) as ScopeValues];
    const failure = gatedResetErrors(scope.children, ancestry);
    if (!isNull(failure)) return { ok: false, errors: failure };
  }

  const columnWrites: {
    uuids: readonly string[];
    main: Record<string, unknown>;
    companion: Record<string, unknown>;
  }[] = [];
  for (const { groupScope, uuids } of writes) {
    const { main, companion } = splitColumns(meta.fields, groupScope.columns);
    const failure = materializeFailure(companionPlan, companion, uuids);
    if (!isNull(failure)) return { ok: false, errors: failure };
    columnWrites.push({ uuids, main, companion });
  }
  for (const { uuids, main, companion } of columnWrites) {
    await updateColumns(tx, dialect, meta.table, meta.fields, main, uuids);
    if (!isEmpty(companion)) {
      await upsertCompanion(tx, dialect, meta, companion, uuids, code, companionPlan);
    }
  }
  await applyReconcile(tx, dialect, plan);

  return {
    ok: true,
    records: await afterUpdate(
      meta.collection,
      await readMatched(meta.collection, matched, locale),
      tx,
      code,
    ),
  };
}

/**
 * Every probe keyed `notUnique` at its path: the shape a guaranteed self-collision rejects with.
 */
function fannedErrors(probes: readonly UniqueProbe[]): FieldErrors {
  const errors: FieldErrors = {};
  for (const probe of probes) errors[probe.path] = 'validation.notUnique';
  return errors;
}

/**
 * The top-level field a dot-path belongs to: the segment before the first `.` or `[`.
 */
function headSegment(path: string): string {
  const end = path.search(/[.[]/);
  return end === -1 ? path : path.slice(0, end);
}

/**
 * Resolves the `UUID`s a condition matches, compiling the same `WHERE` clause the read path does.
 * A condition over translatable fields joins the companion at the effective locale, `LEFT`.
 * A write therefore addresses main rows; a missing translation compares as `NULL`, never dropping the row.
 */
async function matchedUUIDs(
  tx: Transaction,
  dialect: Dialect,
  meta: CollectionQueryMeta,
  condition: ConditionNode,
  locale: string,
): Promise<string[]> {
  const where = compileWhere(condition, meta, dialect, locale);
  const from = compileFrom(meta, { condition }, locale, dialect);
  const uuid = `${dialect.quote(meta.table)}.${dialect.quote('UUID')}`;
  const rows = await tx.query<{ UUID: string }>(
    `SELECT ${uuid} AS ${dialect.quote('UUID')} ${from.sql} WHERE ${where.sql}`,
    [...from.params, ...where.params],
  );
  return rows.map((row) => row.UUID);
}

/**
 * Applies one scope's column update across the matched rows, `_updatedAt` bumped even with no columns set.
 * The set clause is fixed per call, so it binds once and re-binds only the chunked `UUID` list.
 */
async function updateColumns(
  tx: Transaction,
  dialect: Dialect,
  table: string,
  fields: Record<string, FieldQueryMeta>,
  columns: Record<string, unknown>,
  matched: readonly string[],
): Promise<void> {
  const columnType = columnTypes(fields);
  const sets: string[] = [];
  const setParams: SQLValue[] = [];
  for (const [column, value] of Object.entries(columns)) {
    sets.push(`${dialect.quote(column)} = ?`);
    setParams.push(dialect.serialize(columnType.get(column) as LogicalType, value));
  }
  sets.push(`${dialect.quote('_updatedAt')} = ?`);
  setParams.push(Date.now());

  const setClause = sets.join(', ');
  for (const batch of chunk(matched, 900)) {
    const marks = batch.map(() => '?').join(', ');
    await tx.run(
      `UPDATE ${dialect.quote(table)} SET ${setClause} WHERE ${dialect.quote('UUID')} IN (${marks})`,
      [...setParams, ...batch],
    );
  }
}

/**
 * The failures of gated defaults this walk's deactivations actually need, or `null` when none.
 *
 * Mirrors `gateNested`'s decision purely: each item's subfield `when` resolves over the same ancestry.
 * An inactive subfield whose default failed contributes its errors at the item's absolute path.
 * A create with that item's input fails identically, so the update rejects cleanly before any write.
 * Runs per matched record, since a gate may deactivate for one record and hold for another.
 */
function gatedResetErrors(
  children: readonly ProcessedChild[],
  ancestry: readonly ScopeValues[],
): FieldErrors | null {
  let errors: FieldErrors | null = null;
  for (const child of children) {
    for (const [index, item] of child.items.entries()) {
      const itemPath =
        child.meta.kind === 'childOne'
          ? child.path
          : child.meta.kind === 'blocks'
            ? `${child.path}[${index}].fields`
            : `${child.path}[${index}]`;
      const failures = item.gatedDefaultErrors;
      if (!isUndefined(failures)) {
        const resolve = whenResolver(item.values, ancestry);
        for (const [name, meta] of Object.entries(itemSubfields(child, item))) {
          if (isUndefined(meta.when) || evaluateCondition(meta.when, resolve)) continue;
          for (const [key, message] of Object.entries(failures)) {
            if (key !== name && !key.startsWith(`${name}.`) && !key.startsWith(`${name}[`))
              continue;
            (errors ??= {})[prefixPath(itemPath, key)] = message;
          }
        }
      }
      const nested = gatedResetErrors(item.children, [...ancestry, item.values]);
      if (!isNull(nested)) Object.assign((errors ??= {}), nested);
    }
  }
  return errors;
}

/**
 * Every existing composite child row under the matched records, at every nesting depth.
 *
 * An update rewrites the whole subtree of a matched record, so the precheck excludes these rows.
 * A kept value then never collides with a row that is itself being rewritten.
 * A blocks field contributes its instances by per-type row `UUID`, what its probes anchor on.
 * It recurses into each instance's own children.
 * Resolved only when the write carries a table-wide-unique composite probe, so the common write pays nothing.
 */
async function subtreeChildUUIDs(
  tx: Transaction,
  dialect: Dialect,
  fields: Record<string, FieldQueryMeta>,
  parents: readonly string[],
  locale: string,
): Promise<string[]> {
  const all: string[] = [];
  for (const field of Object.values(fields)) {
    if (field.kind === 'blocks') {
      const scoped = field.localeScoped === true ? locale : null;
      const instances = await blockInstancesUnder(
        tx,
        dialect,
        field.table as string,
        parents,
        scoped,
      );
      if (instances.length === 0) continue;
      all.push(...instances.map((instance) => instance.uuid));
      const byType = groupBy(instances, (instance) => instance.type);
      for (const [type, group] of Object.entries(byType)) {
        if (isUndefined(group)) continue;
        all.push(
          ...(await subtreeChildUUIDs(
            tx,
            dialect,
            blockQueryMetadata(type).fields,
            group.map((instance) => instance.uuid),
            locale,
          )),
        );
      }
      continue;
    }
    if (field.kind !== 'childOne' && field.kind !== 'childMany') continue;
    const scoped = field.localeScoped === true ? locale : null;
    const rows = await childUUIDsUnder(tx, dialect, field.table as string, parents, scoped);
    if (rows.length === 0) continue;
    all.push(...rows);
    all.push(
      ...(await subtreeChildUUIDs(
        tx,
        dialect,
        field.subfields as Record<string, FieldQueryMeta>,
        rows,
        locale,
      )),
    );
  }
  return all;
}

/**
 * The `UUID`s of one composite table's rows under any of `parents`, chunked for the driver's `IN` limit.
 * A locale-scoped table passes the locale: an update rewrites one locale's rows, so only those exclude.
 */
async function childUUIDsUnder(
  tx: Transaction,
  dialect: Dialect,
  table: string,
  parents: readonly string[],
  locale: string | null,
): Promise<string[]> {
  const uuids: string[] = [];
  const filter = isNull(locale) ? '' : ` AND ${dialect.quote('_localeCode')} = ?`;
  for (const batch of chunk(parents, 900)) {
    const marks = batch.map(() => '?').join(', ');
    const rows = await tx.query<{ UUID: string }>(
      `SELECT ${dialect.quote('UUID')} FROM ${dialect.quote(table)} ` +
        `WHERE ${dialect.quote('_parentUUID')} IN (${marks})${filter}`,
      isNull(locale) ? [...batch] : [...batch, locale],
    );
    uuids.push(...rows.map((row) => row.UUID));
  }
  return uuids;
}

/**
 * Re-reads the matched records in their final state, chunked so a large update stays under the param cap.
 */
async function readMatched(
  collection: string,
  matched: readonly string[],
  locale: string | null,
): Promise<QueryRecord[]> {
  const records: QueryRecord[] = [];
  for (const batch of chunk(matched, 2000)) {
    const rows = await readRows({
      collection,
      condition: { kind: 'compare', path: ['UUID'], op: 'in', value: batch, negated: false },
      select: null,
      order: [],
      limit: null,
      offset: null,
      populate: [],
      locale,
    });
    records.push(...rows);
  }
  return records;
}
