import type { SQLValue, Transaction } from '../../database/adapter.ts';
import type { Dialect, LogicalType } from '../../database/dialect.ts';
import type { FieldQueryMeta } from '../metadata.ts';
import type { ProcessedChild, ProcessedRelation, ProcessedScope } from '../pipeline/run-record.ts';
import type { ScopeValues } from '../pipeline/when.ts';
import type { FieldErrors } from './errors.ts';

import {
  chunk,
  first,
  groupBy,
  isNull,
  isString,
  isUndefined,
  uniqueArray,
  uuidv7,
} from '../../../utils/index.ts';
import { blockQueryMetadata } from '../metadata.ts';
import { gateNested, gateSubtree } from './activation.ts';
import {
  collectBlockSubtree,
  deleteBlockInstances,
  hasBlocksField,
  ownedBlockInstances,
  type BlockInstance,
} from './blocks.ts';
import { orderKeptWrites, uniqueSubfields, type KeptWrite } from './reorder.ts';

/**
 * The junction column roles of one `records` field, the owner side by default and swapped on the inverse.
 * `self`/`selfPosition` link and order this scope's row; `link`/`linkPosition` the target's.
 */
interface JunctionColumns {
  table: string;
  self: string;
  link: string;
  selfPosition: string;
  linkPosition: string;
}

/**
 * Resolves one `records` field's junction column roles, swapping every role on the inverse side.
 * The owner side links through `_parentUUID`/`_parentPosition`; the inverse reads the same table swapped.
 */
function junctionColumns(meta: FieldQueryMeta): JunctionColumns {
  const inverse = meta.inverse === true;
  return {
    table: meta.table as string,
    self: inverse ? '_targetUUID' : '_parentUUID',
    link: inverse ? '_parentUUID' : '_targetUUID',
    selfPosition: inverse ? '_targetPosition' : '_parentPosition',
    linkPosition: inverse ? '_parentPosition' : '_targetPosition',
  };
}

/**
 * The per-scope column-type memo, keyed on the field map itself.
 * A scope's field map is boot-warmed and immutable, so its column-type map resolves once and lives with it.
 */
const columnTypeCache = new WeakMap<
  Record<string, FieldQueryMeta>,
  ReadonlyMap<string, LogicalType>
>();

/**
 * Maps each column name to its storage primitive, for the bind-time codec, resolved once per scope.
 */
export function columnTypes(
  fields: Record<string, FieldQueryMeta>,
): ReadonlyMap<string, LogicalType> {
  const cached = columnTypeCache.get(fields);
  if (!isUndefined(cached)) return cached;
  const map = new Map<string, LogicalType>();
  for (const field of Object.values(fields)) {
    if (field.column && field.logicalType) map.set(field.column, field.logicalType);
  }
  columnTypeCache.set(fields, map);
  return map;
}

/**
 * One derived-write target: an existing parent row, its effective scope, and the nested-gating ancestry.
 */
export interface ReconcileTarget {
  /**
   * The matched record's `UUID`, the row the derived writes hang off.
   */
  uuid: string;

  /**
   * The scope this record takes: the whole processed scope, or its activation group's narrowed one.
   */
  scope: ProcessedScope;

  /**
   * The nested-gating resolution context, the record's stored shape under the input overlay.
   * `null` on the plain path, where no field gates and every child writes verbatim.
   */
  ancestry: readonly ScopeValues[] | null;
}

/**
 * One planned row insert; `depth` orders parent rows before the rows that reference them.
 */
interface InsertRow {
  table: string;
  depth: number;
  columns: readonly string[];
  values: SQLValue[];
}

/**
 * One kept row's column rewrite, its `SET` fragments and bind values built at plan time.
 */
interface UpdateRow {
  table: string;
  uuid: string;
  sets: string[];
  params: SQLValue[];
}

/**
 * One step of an ordered kept-row sequence: a row's rewrite, or a sentinel freeing a held unique value.
 */
type WriteStep =
  | { kind: 'update'; row: UpdateRow }
  | { kind: 'sentinel'; sub: FieldQueryMeta; uuid: string };

/**
 * One table's kept-row writes whose unique values constrain the order, spanning parents and depths.
 */
interface OrderedWrites {
  table: string;
  steps: WriteStep[];
}

/**
 * One `records` field's resolved junction writes: removals and renumbers per owner, adds across all.
 * `locale` is the bound locale of a locale-scoped junction, `null` otherwise.
 * An add's `linkPosition` resolves at apply time, appended after the target's then-current links.
 */
interface JunctionWrites {
  meta: FieldQueryMeta;
  locale: string | null;
  removals: { owner: string; targets: string[] }[];
  adds: { owner: string; target: string; selfPosition: number }[];
  renumbers: { owner: string; target: string; position: number }[];
}

/**
 * One wrapper row's position renumber, issued only when a kept blocks item actually moved.
 */
interface Renumber {
  table: string;
  uuid: string;
  position: number;
}

/**
 * The reconcile plan: every derived write the reconciliation computed, or the failures that stop it.
 * The plan phase only reads; `applyReconcile` executes it, so a failed plan leaves the database untouched.
 */
export interface ReconcilePlan {
  /**
   * The correlation failures, keyed at their exact dot-paths.
   * A non-empty map fails the write before anything applies.
   */
  errors: FieldErrors;

  /**
   * The doomed row `UUID`s per table: unmatched child rows, cleared objects, and removed wrappers.
   */
  deletes: Map<string, string[]>;

  /**
   * The block instances doomed rows strand, collected to their full subtrees at plan time.
   */
  doomedInstances: BlockInstance[];

  /**
   * The per-parent kept-row sequences whose unique values constrain write order, sentinels included.
   */
  ordered: OrderedWrites[];

  /**
   * The order-free kept-row rewrites; identical statements batch across parents at apply time.
   */
  updates: UpdateRow[];

  /**
   * The planned row inserts, batched into multi-row `VALUES` per table and depth at apply time.
   */
  inserts: InsertRow[];

  /**
   * The resolved junction writes, one entry per `records` field the plan touches.
   */
  junctions: JunctionWrites[];

  /**
   * The wrapper position renumbers of kept blocks items that moved.
   */
  renumbers: Renumber[];
}

/**
 * One pending unit entry: a parent row and the composite child the plan reconciles under it.
 */
interface ChildEntry {
  parent: string;
  child: ProcessedChild;
  ancestry: readonly ScopeValues[] | null;
  depth: number;
}

/**
 * The junction work accumulated during planning: owners needing a diff, and fresh owners' appends.
 */
interface JunctionAccumulator {
  meta: FieldQueryMeta;
  diffs: { owner: string; uuids: readonly string[] }[];
  appends: { owner: string; uuids: readonly string[] }[];
}

/**
 * One kept row's rewrite gathered for its table: the prebuilt write beside what ordering needs.
 */
interface KeptRow extends KeptWrite {
  row: UpdateRow | null;
}

/**
 * One table's kept rewrites across every parent and depth, ordered together once planning ends.
 */
interface KeptTable {
  subfields: Record<string, FieldQueryMeta>;
  rows: KeptRow[];
}

/**
 * Folds one kept row into its table's pending rewrites.
 */
function addKeptRow(
  keptTables: Map<string, KeptTable>,
  table: string,
  subfields: Record<string, FieldQueryMeta>,
  row: KeptRow,
): void {
  const entry = keptTables.get(table);
  if (isUndefined(entry)) keptTables.set(table, { subfields, rows: [row] });
  else entry.rows.push(row);
}

/**
 * An empty plan, the accumulator every planning walk starts from.
 */
function emptyPlan(): ReconcilePlan {
  return {
    errors: {},
    deletes: new Map(),
    doomedInstances: [],
    ordered: [],
    updates: [],
    inserts: [],
    junctions: [],
    renumbers: [],
  };
}

/**
 * Plans a create's whole write: the root row, its derived tree as inserts, and its junction appends.
 * The empty-existing case of the reconciliation: nothing correlates, so the plan needs no reads.
 * The root row carries `_updatedAt`; every descendant row gets a fresh `uuidv7` key.
 */
export function createPlan(
  dialect: Dialect,
  table: string,
  fields: Record<string, FieldQueryMeta>,
  uuid: string,
  scope: ProcessedScope,
  locale: string,
): ReconcilePlan {
  const plan = emptyPlan();
  const junctions = new Map<FieldQueryMeta, JunctionAccumulator>();
  planFresh(plan, junctions, dialect, table, fields, uuid, scope, locale, 'top', 0);
  for (const accumulator of junctions.values()) {
    plan.junctions.push(resolveAppends(accumulator, locale));
  }
  return plan;
}

/**
 * Plans an update's derived writes across every target, one read per composite field and depth.
 *
 * Each level's units group by field, so the existing rows of all parents read in one batched query.
 * That single read feeds correlation and the diff alike: the precheck and the write see the same rows.
 * Correlation failures land in `plan.errors`, keyed exactly as the write addresses each item.
 * A correlated child over several rewriting parents fails `singleRecord` before any row is read.
 * Nested items gate per parent through the ancestry, and correlation validates the effective items.
 * An item a gate substitutes away is therefore never demanded to exist.
 * Kept rows' unique-column values ride the same read, so the write order resolves without another.
 * Kept rewrites gather per table and order once across every parent and depth that writes it.
 */
export async function planReconcile(
  tx: Transaction,
  dialect: Dialect,
  targets: readonly ReconcileTarget[],
  locale: string,
): Promise<ReconcilePlan> {
  const plan = emptyPlan();
  const junctions = new Map<FieldQueryMeta, JunctionAccumulator>();
  const keptTables = new Map<string, KeptTable>();
  let level: ChildEntry[] = [];
  for (const target of targets) {
    for (const relation of target.scope.relations) {
      addJunction(junctions, relation, target.uuid, 'diff');
    }
    for (const child of target.scope.children) {
      level.push({ parent: target.uuid, child, ancestry: target.ancestry, depth: 1 });
    }
  }

  while (level.length > 0) {
    const units = new Map<FieldQueryMeta, ChildEntry[]>();
    for (const entry of level) {
      const unit = units.get(entry.child.meta);
      if (isUndefined(unit)) units.set(entry.child.meta, [entry]);
      else unit.push(entry);
    }
    level = [];
    for (const [meta, entries] of units) {
      if (guardSingleRecord(plan, entries)) continue;
      const next =
        meta.kind === 'blocks'
          ? await planBlocksUnit(tx, dialect, plan, junctions, keptTables, meta, entries, locale)
          : await planChildUnit(tx, dialect, plan, junctions, keptTables, meta, entries, locale);
      level.push(...next);
    }
  }

  emitKeptWrites(plan, dialect, keptTables);
  for (const accumulator of junctions.values()) {
    plan.junctions.push(await resolveJunction(tx, dialect, accumulator, locale));
  }
  return plan;
}

/**
 * Rejects a correlated input subtree fanned across several parents: a kept item addresses one record.
 * No filter can say whose item a `UUID` means, so the update must narrow to a single record first.
 * The fan shows as one shared `ProcessedChild` under several parents.
 * Distinct kept items each carry their own child object, so nested lists under kept siblings stay legal.
 */
function guardSingleRecord(plan: ReconcilePlan, entries: readonly ChildEntry[]): boolean {
  if (entries.length <= 1) return false;
  const parents = new Map<ProcessedChild, number>();
  for (const entry of entries) parents.set(entry.child, (parents.get(entry.child) ?? 0) + 1);
  let guarded = false;
  for (const [child, count] of parents) {
    if (count > 1 && isCorrelated(child)) {
      plan.errors[child.path] = 'validation.singleRecord';
      guarded = true;
    }
  }
  return guarded;
}

/**
 * Whether an update of this child correlates against existing rows: a kept item anywhere the write recurses.
 * Repeater and blocks items correlate by their own `UUID`.
 * An object correlates through its item's children; its single row is addressed by the parent alone.
 */
function isCorrelated(child: ProcessedChild): boolean {
  if (child.meta.kind !== 'childOne') {
    return child.items.some((item) => !isUndefined(item.itemUUID));
  }
  return (first(child.items)?.children ?? []).some(isCorrelated);
}

/**
 * Plans one composite unit: one read of every parent's child rows, then per-parent correlation and diff.
 *
 * A repeater matches by item `UUID`: a match rewrites, an unmatched row dooms, a fresh item inserts.
 * An `object` upserts its single row by parent: an empty list clears it, a value sets it.
 * A doomed row's nested block instances collect once for the whole unit; the rest cascades.
 * Kept items gate per parent through the ancestry; fresh items pre-gate their whole subtree.
 * Kept rewrites gather per table, so the plan orders them across every parent and depth at once.
 * Kept items recurse: their nested children join the next level's units, their relations the junction work.
 */
async function planChildUnit(
  tx: Transaction,
  dialect: Dialect,
  plan: ReconcilePlan,
  junctions: Map<FieldQueryMeta, JunctionAccumulator>,
  keptTables: Map<string, KeptTable>,
  meta: FieldQueryMeta,
  entries: readonly ChildEntry[],
  locale: string,
): Promise<ChildEntry[]> {
  const table = meta.table as string;
  const subfields = meta.subfields as Record<string, FieldQueryMeta>;
  const scoped = meta.localeScoped === true;
  const uniques = uniqueSubfields(subfields);
  const rows = await childRows(
    tx,
    dialect,
    table,
    entries.map((entry) => entry.parent),
    scoped ? locale : null,
    uniques.map((sub) => sub.column as string),
  );

  const next: ChildEntry[] = [];
  const doomed: string[] = [];
  for (const entry of entries) {
    const existing = rows[entry.parent] ?? [];
    if (meta.kind === 'childOne') {
      planObjectEntry(
        plan,
        junctions,
        keptTables,
        dialect,
        meta,
        entry,
        existing,
        doomed,
        next,
        locale,
      );
    } else {
      planListEntry(
        plan,
        junctions,
        keptTables,
        dialect,
        meta,
        entry,
        existing,
        doomed,
        next,
        locale,
      );
    }
  }

  if (doomed.length > 0) {
    appendDeletes(plan, table, doomed);
    if (hasBlocksField(subfields)) {
      plan.doomedInstances.push(
        ...(await collectBlockSubtree(
          tx,
          dialect,
          await ownedBlockInstances(tx, dialect, subfields, doomed),
        )),
      );
    }
  }
  return next;
}

/**
 * Plans one parent's `object` entry: clear, insert fresh, or rewrite the existing row and recurse.
 */
function planObjectEntry(
  plan: ReconcilePlan,
  junctions: Map<FieldQueryMeta, JunctionAccumulator>,
  keptTables: Map<string, KeptTable>,
  dialect: Dialect,
  meta: FieldQueryMeta,
  entry: ChildEntry,
  existing: readonly ExistingRow[],
  doomed: string[],
  next: ChildEntry[],
  locale: string,
): void {
  const table = meta.table as string;
  const subfields = meta.subfields as Record<string, FieldQueryMeta>;
  const head = first(existing);
  const existingUUID = head?.uuid;
  const item = first(entry.child.items);
  if (isUndefined(item)) {
    if (!isUndefined(existingUUID)) doomed.push(existingUUID);
    return;
  }
  if (isUndefined(existingUUID)) {
    const fresh = isNull(entry.ancestry) ? item : gateSubtree(item, subfields, entry.ancestry);
    planFresh(
      plan,
      junctions,
      dialect,
      table,
      subfields,
      uuidv7(),
      fresh,
      locale,
      { uuid: entry.parent, scoped: meta.localeScoped === true },
      entry.depth,
    );
    return;
  }
  const gated = isNull(entry.ancestry) ? item : gateNested(item, subfields, entry.ancestry);
  addKeptRow(keptTables, table, subfields, {
    uuid: existingUUID,
    parent: entry.parent,
    scope: gated,
    stored: head?.stored ?? {},
    row: childUpdateRow(dialect, table, subfields, gated, existingUUID),
  });
  descendKept(next, junctions, gated, existingUUID, entry, item.values);
}

/**
 * Plans one parent's repeater entry: doom unmatched rows, order kept rewrites, insert fresh items.
 * A claimed `UUID` matching no row errors `invalidReference` at the item and plans nothing for it.
 */
function planListEntry(
  plan: ReconcilePlan,
  junctions: Map<FieldQueryMeta, JunctionAccumulator>,
  keptTables: Map<string, KeptTable>,
  dialect: Dialect,
  meta: FieldQueryMeta,
  entry: ChildEntry,
  existing: readonly ExistingRow[],
  doomed: string[],
  next: ChildEntry[],
  locale: string,
): void {
  const table = meta.table as string;
  const subfields = meta.subfields as Record<string, FieldQueryMeta>;
  const items = entry.child.items;
  const byUUID = new Map(existing.map((row) => [row.uuid, row]));
  const consumed = new Set(items.map((item) => item.itemUUID).filter(isString));
  for (const row of existing) {
    if (!consumed.has(row.uuid)) doomed.push(row.uuid);
  }

  const effective: ProcessedScope[] = [];
  const kept: number[] = [];
  for (let index = 0; index < items.length; index++) {
    const item = items[index];
    if (isUndefined(item.itemUUID)) {
      effective.push(isNull(entry.ancestry) ? item : gateSubtree(item, subfields, entry.ancestry));
      continue;
    }
    if (!byUUID.has(item.itemUUID)) {
      plan.errors[`${entry.child.path}[${index}]`] = 'validation.invalidReference';
      effective.push(item);
      continue;
    }
    kept.push(index);
    effective.push(isNull(entry.ancestry) ? item : gateNested(item, subfields, entry.ancestry));
  }

  for (const index of kept) {
    const row = byUUID.get(items[index].itemUUID as string) as ExistingRow;
    addKeptRow(keptTables, table, subfields, {
      uuid: row.uuid,
      parent: entry.parent,
      scope: effective[index],
      stored: row.stored,
      row: childUpdateRow(dialect, table, subfields, effective[index], row.uuid, index),
    });
  }

  for (let index = 0; index < items.length; index++) {
    if (!isUndefined(items[index].itemUUID)) continue;
    planFresh(
      plan,
      junctions,
      dialect,
      table,
      subfields,
      uuidv7(),
      effective[index],
      locale,
      { uuid: entry.parent, position: index, scoped: meta.localeScoped === true },
      entry.depth,
    );
  }
  for (const index of kept) {
    descendKept(
      next,
      junctions,
      effective[index],
      items[index].itemUUID as string,
      entry,
      items[index].values,
    );
  }
}

/**
 * Emits every table's kept rewrites: ordered with sentinels when unique values constrain them, else batched.
 * Each table orders across every parent and depth the plan rewrites in it.
 * A deep claim of a shallow row's freed value therefore never lands before the shallow rewrite vacates it.
 * A row with nothing to set - an item carrying only nested composites - issues no column write.
 * Fresh items always insert after every kept rewrite.
 * A fresh value waiting on a kept row's old value is therefore satisfied by construction.
 */
function emitKeptWrites(
  plan: ReconcilePlan,
  dialect: Dialect,
  keptTables: ReadonlyMap<string, KeptTable>,
): void {
  for (const [table, { subfields, rows }] of keptTables) {
    const steps = orderKeptWrites(dialect, rows, subfields);
    if (isNull(steps)) {
      for (const entry of rows) {
        if (!isNull(entry.row)) plan.updates.push(entry.row);
      }
      continue;
    }
    const sequence: WriteStep[] = [];
    for (const step of steps) {
      if (step.kind === 'sentinel') {
        sequence.push(step);
        continue;
      }
      const row = rows[step.index].row;
      if (!isNull(row)) sequence.push({ kind: 'update', row });
    }
    plan.ordered.push({ table, steps: sequence });
  }
}

/**
 * Plans one blocks unit: one read of every parent's wrapper rows, then per-parent correlation and diff.
 *
 * An unmatched wrapper row dooms with its whole instance subtree, collected once for the unit.
 * An item `UUID` outside the parent's (locale's) wrappers is an `invalidReference` at the item.
 * An instance's type is immutable, so a type change errors at the item's `UUID`.
 * Kept items rewrite their per-type row and renumber the wrapper only when moved.
 * Their rewrites gather per type table, ordered with every other rewrite of that table at plan end.
 * Fresh items plan a new instance subtree and the wrapper row placing it at the item's index.
 */
async function planBlocksUnit(
  tx: Transaction,
  dialect: Dialect,
  plan: ReconcilePlan,
  junctions: Map<FieldQueryMeta, JunctionAccumulator>,
  keptTables: Map<string, KeptTable>,
  meta: FieldQueryMeta,
  entries: readonly ChildEntry[],
  locale: string,
): Promise<ChildEntry[]> {
  const table = meta.table as string;
  const scoped = meta.localeScoped === true;
  const rows = await wrapperRowsUnder(
    tx,
    dialect,
    table,
    entries.map((entry) => entry.parent),
    scoped ? locale : null,
  );

  const next: ChildEntry[] = [];
  const doomedWrappers: string[] = [];
  const removedInstances: BlockInstance[] = [];
  for (const entry of entries) {
    const existing = rows[entry.parent] ?? [];
    const byInstance = new Map(existing.map((row) => [row.instance, row]));
    const items = entry.child.items;
    const consumed = new Set(items.map((item) => item.itemUUID).filter(isString));
    for (const row of existing) {
      if (consumed.has(row.instance)) continue;
      doomedWrappers.push(row.uuid);
      removedInstances.push({ type: row.type, uuid: row.instance });
    }

    const effective: ProcessedScope[] = [];
    const kept: number[] = [];
    for (let index = 0; index < items.length; index++) {
      const item = items[index];
      const fields = blockQueryMetadata(item.blockType as string).fields;
      if (isUndefined(item.itemUUID)) {
        effective.push(isNull(entry.ancestry) ? item : gateSubtree(item, fields, entry.ancestry));
        const instance = uuidv7();
        planFresh(
          plan,
          junctions,
          dialect,
          blockQueryMetadata(item.blockType as string).table,
          fields,
          instance,
          effective[index],
          locale,
          'block',
          entry.depth,
        );
        plan.inserts.push(
          wrapperInsert(entry.parent, index, item.blockType as string, instance, scoped, locale, {
            table,
            depth: entry.depth,
          }),
        );
        continue;
      }
      const wrapper = byInstance.get(item.itemUUID);
      if (isUndefined(wrapper)) {
        plan.errors[`${entry.child.path}[${index}]`] = 'validation.invalidReference';
        effective.push(item);
        continue;
      }
      if (wrapper.type !== item.blockType) {
        plan.errors[`${entry.child.path}[${index}].UUID`] = 'validation.invalidReference';
        effective.push(item);
        continue;
      }
      effective.push(isNull(entry.ancestry) ? item : gateNested(item, fields, entry.ancestry));
      kept.push(index);
      if (wrapper.position !== index) {
        plan.renumbers.push({ table, uuid: wrapper.uuid, position: index });
      }
    }

    const keptByType = groupBy(kept, (index) => items[index].blockType as string);
    for (const [type, indexes] of Object.entries(keptByType)) {
      if (isUndefined(indexes)) continue;
      const blockMeta = blockQueryMetadata(type);
      const uniques = uniqueSubfields(blockMeta.fields);
      const stored =
        uniques.length === 0
          ? new Map<string, Record<string, SQLValue>>()
          : await storedUniqueValues(
              tx,
              dialect,
              blockMeta.table,
              uniques.map((sub) => sub.column as string),
              indexes.map((index) => items[index].itemUUID as string),
            );
      for (const index of indexes) {
        const instance = items[index].itemUUID as string;
        addKeptRow(keptTables, blockMeta.table, blockMeta.fields, {
          uuid: instance,
          parent: entry.parent,
          scope: effective[index],
          stored: stored.get(instance) ?? {},
          row: childUpdateRow(
            dialect,
            blockMeta.table,
            blockMeta.fields,
            effective[index],
            instance,
          ),
        });
      }
    }
    for (const indexes of Object.values(keptByType)) {
      if (isUndefined(indexes)) continue;
      for (const index of indexes) {
        descendKept(
          next,
          junctions,
          effective[index],
          items[index].itemUUID as string,
          entry,
          items[index].values,
        );
      }
    }
  }

  if (doomedWrappers.length > 0) appendDeletes(plan, table, doomedWrappers);
  if (removedInstances.length > 0) {
    plan.doomedInstances.push(...(await collectBlockSubtree(tx, dialect, removedInstances)));
  }
  return next;
}

/**
 * One fresh blocks item's wrapper row, placing its instance under the owner at the item's index.
 */
function wrapperInsert(
  parent: string,
  position: number,
  type: string,
  instance: string,
  scoped: boolean,
  locale: string,
  home: { table: string; depth: number },
): InsertRow {
  const columns = ['UUID', '_parentUUID', '_parentPosition', '_blockType', '_blockUUID'];
  const values: SQLValue[] = [uuidv7(), parent, position, type, instance];
  if (scoped) {
    columns.push('_localeCode');
    values.push(locale);
  }
  return { table: home.table, depth: home.depth, columns, values };
}

/**
 * Queues a kept row's own nested work: its relations join the junction diffs, its children the next level.
 * The ancestry extends with the item's coerced values; the plain path's `null` stays `null`.
 */
function descendKept(
  next: ChildEntry[],
  junctions: Map<FieldQueryMeta, JunctionAccumulator>,
  scope: ProcessedScope,
  uuid: string,
  entry: ChildEntry,
  values: ScopeValues,
): void {
  for (const relation of scope.relations) addJunction(junctions, relation, uuid, 'diff');
  const ancestry = isNull(entry.ancestry) ? null : [...entry.ancestry, values];
  for (const child of scope.children) {
    next.push({ parent: uuid, child, ancestry, depth: entry.depth + 1 });
  }
}

/**
 * Plans one fresh scope: its row, then its junction appends and child subtrees, depth-first.
 *
 * Three row modes, keyed on `parent`. `'top'` is the record root and carries `_updatedAt`.
 * An object literal marks a child row: `_parentUUID`, a repeater position, `_localeCode` when scoped.
 * `'block'` marks a block instance row: a per-type table has no parent link and no timestamp.
 * Every descendant row gets a fresh `uuidv7`.
 * A claimed item `UUID` under a fresh parent is ignored, exactly as the plan's Q6 deferral sanctions.
 */
function planFresh(
  plan: ReconcilePlan,
  junctions: Map<FieldQueryMeta, JunctionAccumulator>,
  dialect: Dialect,
  table: string,
  fields: Record<string, FieldQueryMeta>,
  uuid: string,
  scope: ProcessedScope,
  locale: string,
  parent: { uuid: string; position?: number; scoped?: boolean } | 'top' | 'block',
  depth: number,
): void {
  const columns: string[] = ['UUID'];
  const values: SQLValue[] = [uuid];
  if (parent === 'top') {
    columns.push('_updatedAt');
    values.push(Date.now());
  } else if (parent !== 'block') {
    columns.push('_parentUUID');
    values.push(parent.uuid);
    if (parent.scoped === true) {
      columns.push('_localeCode');
      values.push(locale);
    }
    if (!isUndefined(parent.position)) {
      columns.push('_parentPosition');
      values.push(parent.position);
    }
  }
  const columnType = columnTypes(fields);
  for (const [column, value] of Object.entries(scope.columns)) {
    columns.push(column);
    values.push(dialect.serialize(columnType.get(column) as LogicalType, value));
  }
  plan.inserts.push({ table, depth, columns, values });

  for (const relation of scope.relations) addJunction(junctions, relation, uuid, 'append');

  for (const child of scope.children) {
    if (child.meta.kind === 'blocks') {
      const scoped = child.meta.localeScoped === true;
      for (let index = 0; index < child.items.length; index++) {
        const item = child.items[index];
        const blockMeta = blockQueryMetadata(item.blockType as string);
        const instance = uuidv7();
        planFresh(
          plan,
          junctions,
          dialect,
          blockMeta.table,
          blockMeta.fields,
          instance,
          item,
          locale,
          'block',
          depth + 1,
        );
        plan.inserts.push(
          wrapperInsert(uuid, index, item.blockType as string, instance, scoped, locale, {
            table: child.meta.table as string,
            depth: depth + 1,
          }),
        );
      }
      continue;
    }
    const childTable = child.meta.table as string;
    const childFields = child.meta.subfields as Record<string, FieldQueryMeta>;
    const positioned = child.meta.kind === 'childMany';
    for (let index = 0; index < child.items.length; index++) {
      planFresh(
        plan,
        junctions,
        dialect,
        childTable,
        childFields,
        uuidv7(),
        child.items[index],
        locale,
        {
          uuid,
          position: positioned ? index : undefined,
          scoped: child.meta.localeScoped === true,
        },
        depth + 1,
      );
    }
  }
}

/**
 * Accumulates one owner's junction work: a diff for an existing row, pure appends for a fresh one.
 * An empty fresh list is dropped - there is nothing to append - while an empty diff still clears links.
 */
function addJunction(
  junctions: Map<FieldQueryMeta, JunctionAccumulator>,
  relation: ProcessedRelation,
  owner: string,
  mode: 'diff' | 'append',
): void {
  if (mode === 'append' && relation.uuids.length === 0) return;
  let accumulator = junctions.get(relation.meta);
  if (isUndefined(accumulator)) {
    accumulator = { meta: relation.meta, diffs: [], appends: [] };
    junctions.set(relation.meta, accumulator);
  }
  (mode === 'diff' ? accumulator.diffs : accumulator.appends).push({
    owner,
    uuids: relation.uuids,
  });
}

/**
 * Resolves a create's junction accumulator: every owner is fresh, so the writes are pure appends.
 */
function resolveAppends(accumulator: JunctionAccumulator, locale: string): JunctionWrites {
  const scoped = accumulator.meta.localeScoped === true ? locale : null;
  const writes: JunctionWrites = {
    meta: accumulator.meta,
    locale: scoped,
    removals: [],
    adds: [],
    renumbers: [],
  };
  for (const { owner, uuids } of accumulator.appends) {
    uuids.forEach((target, index) => writes.adds.push({ owner, target, selfPosition: index }));
  }
  return writes;
}

/**
 * Resolves one junction's writes: one read of every diffing owner's links, then the per-owner diff.
 * Removed links delete, added ones append with their input position, kept ones renumber when moved.
 * An unchanged input therefore resolves to no writes at all.
 */
async function resolveJunction(
  tx: Transaction,
  dialect: Dialect,
  accumulator: JunctionAccumulator,
  locale: string,
): Promise<JunctionWrites> {
  const writes = resolveAppends(accumulator, locale);
  if (accumulator.diffs.length === 0) return writes;
  const cols = junctionColumns(accumulator.meta);
  const existing = await junctionRows(
    tx,
    dialect,
    cols,
    accumulator.diffs.map((diff) => diff.owner),
    writes.locale,
  );
  for (const { owner, uuids } of accumulator.diffs) {
    const current = new Map((existing[owner] ?? []).map((row) => [row.target, row.pos]));
    const inputSet = new Set(uuids);
    const removed = [...current.keys()].filter((target) => !inputSet.has(target));
    if (removed.length > 0) writes.removals.push({ owner, targets: removed });
    uuids.forEach((target, index) => {
      const position = current.get(target);
      if (isUndefined(position)) writes.adds.push({ owner, target, selfPosition: index });
      else if (position !== index) writes.renumbers.push({ owner, target, position: index });
    });
  }
  return writes;
}

/**
 * Applies a reconcile plan in dependency order, each phase batched across parents and depths.
 *
 * Dooms delete first, freeing every value a rewrite or insert may take.
 * Ordered kept sequences run next, sentinels included; order-free rewrites batch by identical statement.
 * Inserts sort by depth and batch into multi-row `VALUES`, so a parent row lands before its children.
 * Junction writes follow, since their rows reference the freshly inserted owners.
 * Wrapper renumbers close the plan.
 */
export async function applyReconcile(
  tx: Transaction,
  dialect: Dialect,
  plan: ReconcilePlan,
): Promise<void> {
  for (const [table, uuids] of plan.deletes) {
    for (const batch of chunk(uuids, 900)) {
      const marks = batch.map(() => '?').join(', ');
      await tx.run(
        `DELETE FROM ${dialect.quote(table)} WHERE ${dialect.quote('UUID')} IN (${marks})`,
        [...batch],
      );
    }
  }
  if (plan.doomedInstances.length > 0) {
    await deleteBlockInstances(tx, dialect, plan.doomedInstances);
  }

  for (const sequence of plan.ordered) {
    for (const step of sequence.steps) {
      if (step.kind === 'sentinel') {
        await writeSentinel(tx, dialect, sequence.table, step.sub, step.uuid);
        continue;
      }
      const { table, uuid, sets, params } = step.row;
      await tx.run(
        `UPDATE ${dialect.quote(table)} SET ${sets.join(', ')} WHERE ${dialect.quote('UUID')} = ?`,
        [...params, uuid],
      );
    }
  }

  await applyBatchedUpdates(tx, dialect, plan.updates);
  await applyInserts(tx, dialect, plan.inserts);
  for (const junction of plan.junctions) await applyJunction(tx, dialect, junction);

  for (const { table, uuid, position } of plan.renumbers) {
    await tx.run(
      `UPDATE ${dialect.quote(table)} SET ${dialect.quote('_parentPosition')} = ? ` +
        `WHERE ${dialect.quote('UUID')} = ?`,
      [position, uuid],
    );
  }
}

/**
 * Applies the order-free kept rewrites, rows sharing a statement and values collapsing into one `IN`.
 * Multi-parent rewrites of one shared scope - every object row of a bulk update - cost one statement.
 */
async function applyBatchedUpdates(
  tx: Transaction,
  dialect: Dialect,
  updates: readonly UpdateRow[],
): Promise<void> {
  const groups = groupBy(
    updates,
    (row) => `${row.table}\u0000${row.sets.join(', ')}\u0000${JSON.stringify(row.params)}`,
  );
  for (const group of Object.values(groups)) {
    if (isUndefined(group)) continue;
    const { table, sets, params } = group[0];
    for (const batch of chunk(
      group.map((row) => row.uuid),
      900,
    )) {
      const marks = batch.map(() => '?').join(', ');
      await tx.run(
        `UPDATE ${dialect.quote(table)} SET ${sets.join(', ')} ` +
          `WHERE ${dialect.quote('UUID')} IN (${marks})`,
        [...params, ...batch],
      );
    }
  }
}

/**
 * Applies the planned inserts: depth order first, then multi-row `VALUES` per table and column shape.
 * Rows at one depth never reference each other, and a parent's depth is always below its children's.
 * Every batch therefore lands after the rows it references.
 */
async function applyInserts(
  tx: Transaction,
  dialect: Dialect,
  inserts: readonly InsertRow[],
): Promise<void> {
  const groups = groupBy(
    [...inserts].sort((a, b) => a.depth - b.depth),
    (insert) => `${insert.depth}\u0000${insert.table}\u0000${insert.columns.join(',')}`,
  );
  for (const group of Object.values(groups)) {
    if (isUndefined(group)) continue;
    const { table, columns } = group[0];
    const quoted = columns.map((column) => dialect.quote(column)).join(', ');
    const width = Math.max(1, Math.floor(900 / columns.length));
    for (const batch of chunk(
      group.map((insert) => insert.values),
      width,
    )) {
      const tuples = batch.map(() => `(${columns.map(() => '?').join(', ')})`).join(', ');
      await tx.run(
        `INSERT INTO ${dialect.quote(table)} (${quoted}) VALUES ${tuples}`,
        batch.flat(),
      );
    }
  }
}

/**
 * Applies one junction's writes: removals per owner, appended adds in one batch, renumbers per link.
 * The append positions read after the removals, so a freed slot never inflates the next position.
 */
async function applyJunction(
  tx: Transaction,
  dialect: Dialect,
  writes: JunctionWrites,
): Promise<void> {
  const cols = junctionColumns(writes.meta);
  const table = dialect.quote(cols.table);
  const self = dialect.quote(cols.self);
  const link = dialect.quote(cols.link);
  const scoped = !isNull(writes.locale);
  const filter = scoped ? ` AND ${dialect.quote('_localeCode')} = ?` : '';
  const scopeParams: SQLValue[] = scoped ? [writes.locale] : [];

  for (const { owner, targets } of writes.removals) {
    for (const batch of chunk(targets, 900)) {
      const marks = batch.map(() => '?').join(', ');
      await tx.run(`DELETE FROM ${table} WHERE ${self} = ? AND ${link} IN (${marks})${filter}`, [
        owner,
        ...batch,
        ...scopeParams,
      ]);
    }
  }

  if (writes.adds.length > 0) {
    const nextByTarget = await appendPositions(
      tx,
      dialect,
      cols.table,
      cols.link,
      cols.linkPosition,
      writes.adds.map((add) => add.target),
      writes.locale,
    );
    const rows = writes.adds.map(({ owner, target, selfPosition }) => {
      const linkPosition = nextByTarget.get(target) ?? 0;
      nextByTarget.set(target, linkPosition + 1);
      const row: SQLValue[] = [owner, target, selfPosition, linkPosition];
      if (scoped) row.push(writes.locale);
      return row;
    });
    const columns = [cols.self, cols.link, cols.selfPosition, cols.linkPosition];
    if (scoped) columns.push('_localeCode');
    const quoted = columns.map((column) => dialect.quote(column)).join(', ');
    const width = Math.max(1, Math.floor(900 / columns.length));
    for (const batch of chunk(rows, width)) {
      const tuples = batch.map(() => `(${columns.map(() => '?').join(', ')})`).join(', ');
      await tx.run(`INSERT INTO ${table} (${quoted}) VALUES ${tuples}`, batch.flat());
    }
  }

  for (const { owner, target, position } of writes.renumbers) {
    await tx.run(
      `UPDATE ${table} SET ${dialect.quote(cols.selfPosition)} = ? ` +
        `WHERE ${self} = ? AND ${link} = ?${filter}`,
      [position, owner, target, ...scopeParams],
    );
  }
}

/**
 * The next position to append at, per target, one past that target's current maximum in the junction.
 * A locale-scoped junction orders per (target, locale), so `locale` narrows the maximum it counts from.
 */
async function appendPositions(
  tx: Transaction,
  dialect: Dialect,
  table: string,
  linkColumn: string,
  linkPosition: string,
  targets: readonly string[],
  locale: string | null,
): Promise<Map<string, number>> {
  const next = new Map<string, number>();
  const column = dialect.quote(linkColumn);
  const filter = isNull(locale) ? '' : ` AND ${dialect.quote('_localeCode')} = ?`;
  for (const batch of chunk(uniqueArray(targets), 900)) {
    const marks = batch.map(() => '?').join(', ');
    const rows = await tx.query<{ target: string; max: number | null }>(
      `SELECT ${column} AS "target", MAX(${dialect.quote(linkPosition)}) AS "max" ` +
        `FROM ${dialect.quote(table)} WHERE ${column} IN (${marks})${filter} GROUP BY ${column}`,
      isNull(locale) ? batch : [...batch, locale],
    );
    for (const row of rows) next.set(row.target, (row.max ?? -1) + 1);
  }
  return next;
}

/**
 * One existing child row: its key, its parent, and its stored values for the columns the unit read.
 */
interface ExistingRow {
  uuid: string;
  parent: string;
  stored: Record<string, SQLValue>;
}

/**
 * One read of a composite table's rows under every parent, keyed by parent, unique columns included.
 * A locale-scoped table binds the locale, so another locale's items never correlate or doom.
 */
async function childRows(
  tx: Transaction,
  dialect: Dialect,
  table: string,
  parents: readonly string[],
  locale: string | null,
  columns: readonly string[],
): Promise<Partial<Record<string, ExistingRow[]>>> {
  const all: ExistingRow[] = [];
  const select = ['UUID', '_parentUUID', ...columns]
    .map((column) => dialect.quote(column))
    .join(', ');
  const filter = isNull(locale) ? '' : ` AND ${dialect.quote('_localeCode')} = ?`;
  for (const batch of chunk(parents, 900)) {
    const marks = batch.map(() => '?').join(', ');
    const rows = await tx.query<Record<string, SQLValue>>(
      `SELECT ${select} FROM ${dialect.quote(table)} ` +
        `WHERE ${dialect.quote('_parentUUID')} IN (${marks})${filter}`,
      isNull(locale) ? [...batch] : [...batch, locale],
    );
    all.push(
      ...rows.map((row) => ({
        uuid: row.UUID as string,
        parent: row._parentUUID as string,
        stored: row,
      })),
    );
  }
  return groupBy(all, (row) => row.parent);
}

/**
 * One wrapper row of a blocks field: its own key, its parent, the placed instance, type, and position.
 */
interface WrapperRow {
  uuid: string;
  parent: string;
  instance: string;
  type: string;
  position: number;
}

/**
 * One read of a blocks table's wrapper rows under every parent, keyed by parent.
 * A locale-scoped wrapper binds the locale, so another locale's items never correlate or doom.
 */
async function wrapperRowsUnder(
  tx: Transaction,
  dialect: Dialect,
  table: string,
  parents: readonly string[],
  locale: string | null,
): Promise<Partial<Record<string, WrapperRow[]>>> {
  const all: WrapperRow[] = [];
  const filter = isNull(locale) ? '' : ` AND ${dialect.quote('_localeCode')} = ?`;
  for (const batch of chunk(parents, 900)) {
    const marks = batch.map(() => '?').join(', ');
    const rows = await tx.query<WrapperRow>(
      `SELECT ${dialect.quote('UUID')} AS ${dialect.quote('uuid')}, ` +
        `${dialect.quote('_parentUUID')} AS ${dialect.quote('parent')}, ` +
        `${dialect.quote('_blockUUID')} AS ${dialect.quote('instance')}, ` +
        `${dialect.quote('_blockType')} AS ${dialect.quote('type')}, ` +
        `${dialect.quote('_parentPosition')} AS ${dialect.quote('position')} ` +
        `FROM ${dialect.quote(table)} WHERE ${dialect.quote('_parentUUID')} IN (${marks})${filter}`,
      isNull(locale) ? [...batch] : [...batch, locale],
    );
    all.push(...rows);
  }
  return groupBy(all, (row) => row.parent);
}

/**
 * One read of a junction table's links for every diffing owner, keyed by owner.
 */
async function junctionRows(
  tx: Transaction,
  dialect: Dialect,
  cols: JunctionColumns,
  owners: readonly string[],
  locale: string | null,
): Promise<Partial<Record<string, { owner: string; target: string; pos: number }[]>>> {
  const all: { owner: string; target: string; pos: number }[] = [];
  const filter = isNull(locale) ? '' : ` AND ${dialect.quote('_localeCode')} = ?`;
  for (const batch of chunk(owners, 900)) {
    const marks = batch.map(() => '?').join(', ');
    const rows = await tx.query<{ owner: string; target: string; pos: number }>(
      `SELECT ${dialect.quote(cols.self)} AS "owner", ${dialect.quote(cols.link)} AS "target", ` +
        `${dialect.quote(cols.selfPosition)} AS "pos" FROM ${dialect.quote(cols.table)} ` +
        `WHERE ${dialect.quote(cols.self)} IN (${marks})${filter}`,
      isNull(locale) ? [...batch] : [...batch, locale],
    );
    all.push(...rows);
  }
  return groupBy(all, (row) => row.owner);
}

/**
 * The kept rows' current unique-column values, keyed by row `UUID`, for a blocks type's write order.
 */
async function storedUniqueValues(
  tx: Transaction,
  dialect: Dialect,
  table: string,
  columns: readonly string[],
  uuids: readonly string[],
): Promise<Map<string, Record<string, SQLValue>>> {
  const stored = new Map<string, Record<string, SQLValue>>();
  const select = ['UUID', ...columns].map((column) => dialect.quote(column)).join(', ');
  for (const batch of chunk(uuids, 900)) {
    const marks = batch.map(() => '?').join(', ');
    const rows = await tx.query<Record<string, SQLValue>>(
      `SELECT ${select} FROM ${dialect.quote(table)} WHERE ${dialect.quote('UUID')} IN (${marks})`,
      [...batch],
    );
    for (const row of rows) stored.set(row.UUID as string, row);
  }
  return stored;
}

/**
 * One kept row's rewrite, its `_parentPosition` folded in when the row sits in a repeater.
 * `null` when there is nothing to set - an item carrying only nested composites issues no write.
 */
function childUpdateRow(
  dialect: Dialect,
  table: string,
  subfields: Record<string, FieldQueryMeta>,
  item: ProcessedScope,
  uuid: string,
  position?: number,
): UpdateRow | null {
  const columnType = columnTypes(subfields);
  const sets: string[] = [];
  const params: SQLValue[] = [];
  for (const [column, value] of Object.entries(item.columns)) {
    sets.push(`${dialect.quote(column)} = ?`);
    params.push(dialect.serialize(columnType.get(column) as LogicalType, value));
  }
  if (!isUndefined(position)) {
    sets.push(`${dialect.quote('_parentPosition')} = ?`);
    params.push(position);
  }
  if (sets.length === 0) return null;
  return { table, uuid, sets, params };
}

/**
 * Folds doomed row keys into the plan's per-table delete set.
 */
function appendDeletes(plan: ReconcilePlan, table: string, uuids: readonly string[]): void {
  const existing = plan.deletes.get(table);
  if (isUndefined(existing)) plan.deletes.set(table, [...uuids]);
  else existing.push(...uuids);
}

/**
 * Moves one kept row off its held unique value, so the writes waiting on it can land.
 * A non-nullable boolean writes nothing: no third value exists, and the constraint decides.
 */
async function writeSentinel(
  tx: Transaction,
  dialect: Dialect,
  table: string,
  sub: FieldQueryMeta,
  uuid: string,
): Promise<void> {
  const column = sub.column as string;
  const type = sub.logicalType as LogicalType;
  if (!sub.nullable && type === 'boolean') return;
  const value = sub.nullable ? null : await freeValue(tx, dialect, table, column, type);
  await tx.run(
    `UPDATE ${dialect.quote(table)} SET ${dialect.quote(column)} = ? WHERE ${dialect.quote('UUID')} = ?`,
    [value, uuid],
  );
}

/**
 * A value no row of the table holds: a fresh `uuidv7` for text shapes, one past the maximum else.
 * A `real` column doubles a positive maximum instead: doubling stays exact where `+ 1` rounds away.
 */
async function freeValue(
  tx: Transaction,
  dialect: Dialect,
  table: string,
  column: string,
  type: LogicalType,
): Promise<SQLValue> {
  if (type === 'text' || type === 'json') return dialect.serialize(type, uuidv7());
  const row = await tx.queryOne<{ max: number | null }>(
    `SELECT MAX(${dialect.quote(column)}) AS ${dialect.quote('max')} FROM ${dialect.quote(table)}`,
  );
  const max = row?.max ?? 0;
  if (type !== 'real') return max + 1;
  return max <= 0 ? 1 : max * 2;
}
