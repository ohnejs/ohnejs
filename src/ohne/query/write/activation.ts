import type { ConditionNode } from '../../../utils/index.ts';
import type { LogicalType } from '../../database/dialect.ts';
import type { FieldQueryMeta } from '../metadata.ts';
import type { ProcessedChild, ProcessedRelation, ProcessedScope } from '../pipeline/run-record.ts';
import type { ScopeValues } from '../pipeline/when.ts';

import { evaluateCondition, hasKey, isEmpty, isNull, isUndefined } from '../../../utils/index.ts';
import { coerceColumn } from '../pipeline/preflight.ts';
import { whenResolver } from '../pipeline/when.ts';

/**
 * A provided top-level field whose `when` decides, per matched record, whether the update writes it.
 * It carries the field's contribution to the scope, so an inactive record can drop exactly that part.
 */
export interface WhenGate {
  /**
   * The gated field's name.
   */
  name: string;

  /**
   * The field's parsed `when`, evaluated per matched record over its input overlaid on the row.
   */
  when: ConditionNode;

  /**
   * The main-table column the field writes; column and `record` kinds only.
   */
  column?: string;

  /**
   * The `records` write the field contributes; `records` kind only.
   */
  relation?: ProcessedRelation;

  /**
   * The composite write the field contributes; `object`/`repeater` kinds only.
   */
  child?: ProcessedChild;
}

/**
 * One activation group: the matched records sharing an active gate set, and which gates are active.
 */
export interface ActivationGroup {
  /**
   * The `UUID`s whose records all activate the same gates.
   */
  uuids: string[];

  /**
   * The names of the gates active for this group.
   */
  active: Set<string>;
}

/**
 * The gates an update carries: provided top-level fields with a `when`, paired with their contribution.
 * A field the input omits is skipped, so only fields the call actually writes can gate.
 */
export function whenGates(
  fields: Record<string, FieldQueryMeta>,
  input: Readonly<Record<string, unknown>>,
  scope: ProcessedScope,
): WhenGate[] {
  const gates: WhenGate[] = [];
  for (const [name, meta] of Object.entries(fields)) {
    if (isUndefined(meta.when) || !hasKey(input, name)) continue;
    const gate: WhenGate = { name, when: meta.when };
    if (meta.kind === 'column' || meta.kind === 'record') gate.column = meta.column;
    else if (meta.kind === 'records') gate.relation = scope.relations.find((r) => r.meta === meta);
    else gate.child = scope.children.find((c) => c.meta === meta);
    gates.push(gate);
  }
  return gates;
}

/**
 * The coerced values of the update's provided top-level fields, the input side of the activation overlay.
 * A provided field's own value wins over the stored row, so a `when` sees what the update would write.
 */
export function coercedOverlay(
  fields: Record<string, FieldQueryMeta>,
  input: Readonly<Record<string, unknown>>,
): Record<string, unknown> {
  const values: Record<string, unknown> = {};
  for (const [name, meta] of Object.entries(fields)) {
    if (!hasKey(input, name)) continue;
    const raw = input[name];
    values[name] =
      meta.kind === 'column' && !isNull(raw)
        ? coerceColumn(raw, meta.logicalType as LogicalType)
        : raw;
  }
  return values;
}

/**
 * Partitions matched records into activation groups, keyed by which gates each record's `when` activates.
 *
 * Each record's overlay is its full stored shape - columns, relations, and composites - under the provided input.
 * A gate reading a relation or composite therefore resolves against the persisted membership, as on a create.
 * Groups keep first-seen order, so the writes stay deterministic across a run.
 */
export function partitionActivation(
  records: readonly Record<string, unknown>[],
  gates: readonly WhenGate[],
  provided: Record<string, unknown>,
): ActivationGroup[] {
  const order: string[] = [];
  const byKey = new Map<string, ActivationGroup>();
  for (const record of records) {
    const overlay = { ...record, ...provided };
    const resolve = whenResolver(overlay, []);
    const active = new Set<string>();
    for (const gate of gates) if (evaluateCondition(gate.when, resolve)) active.add(gate.name);
    const key = gates.map((gate) => (active.has(gate.name) ? '1' : '0')).join('');
    let group = byKey.get(key);
    if (isUndefined(group)) {
      group = { uuids: [], active };
      byKey.set(key, group);
      order.push(key);
    }
    group.uuids.push(record.UUID as string);
  }
  return order.map((key) => byKey.get(key) as ActivationGroup);
}

/**
 * Narrows a scope to one activation group: every inactive gate's column, relation, and child drops out.
 * Non-gated fields always survive, so they write to every group; only a gated inactive field is withheld.
 */
export function activeScope(
  scope: ProcessedScope,
  gates: readonly WhenGate[],
  active: ReadonlySet<string>,
): ProcessedScope {
  const columns = new Set<string>();
  const relations = new Set<ProcessedRelation>();
  const children = new Set<ProcessedChild>();
  for (const gate of gates) {
    if (active.has(gate.name)) continue;
    if (!isUndefined(gate.column)) columns.add(gate.column);
    if (!isUndefined(gate.relation)) relations.add(gate.relation);
    if (!isUndefined(gate.child)) children.add(gate.child);
  }
  const kept: Record<string, unknown> = {};
  for (const [column, value] of Object.entries(scope.columns)) {
    if (!columns.has(column)) kept[column] = value;
  }
  return {
    columns: kept,
    values: scope.values,
    relations: scope.relations.filter((relation) => !relations.has(relation)),
    children: scope.children.filter((child) => !children.has(child)),
    refs: [],
    uniqueProbes: [],
  };
}

/**
 * Whether a narrowed scope writes nothing: an empty-signature record, left untouched with no `_updatedAt` bump.
 */
export function isEmptyScope(scope: ProcessedScope): boolean {
  return isEmpty(scope.columns) && scope.relations.length === 0 && scope.children.length === 0;
}

/**
 * Whether any composite subfield, at any depth, declares a `when` - so an update must gate per matched record.
 */
export function hasNestedGates(scope: ProcessedScope): boolean {
  return scope.children.some(
    (child) =>
      Object.values(child.meta.subfields as Record<string, FieldQueryMeta>).some(
        (field) => !isUndefined(field.when),
      ) || child.items.some(hasNestedGates),
  );
}

/**
 * Narrows a nested item to one matched parent, replacing every inactive subfield with its default.
 *
 * Each gated subfield's `when` resolves against the item's coerced values over `ancestry`, root overlay first.
 * An inactive subfield takes its default, exactly as a create or an omitted subfield does.
 * A column takes its serialized `gatedDefaults` value; a relation or composite takes its empty form.
 * A matched row then SETs that default; a fresh row inserts it; an emptied relation deletes its rows.
 */
export function gateNested(
  item: ProcessedScope,
  subfields: Record<string, FieldQueryMeta>,
  ancestry: readonly ScopeValues[],
): ProcessedScope {
  const resolve = whenResolver(item.values, ancestry);
  let columns: Record<string, unknown> | undefined;
  let relations: ProcessedRelation[] | undefined;
  let children: ProcessedChild[] | undefined;
  for (const [name, meta] of Object.entries(subfields)) {
    if (isUndefined(meta.when) || evaluateCondition(meta.when, resolve)) continue;
    if (meta.kind === 'column' || meta.kind === 'record') {
      (columns ??= { ...item.columns })[meta.column as string] = item.gatedDefaults?.[name];
    } else if (meta.kind === 'records') {
      relations = (relations ?? item.relations).map((relation) =>
        relation.meta === meta ? { meta, uuids: [] } : relation,
      );
    } else {
      children = (children ?? item.children).map((child) =>
        child.meta === meta ? { ...child, items: [] } : child,
      );
    }
  }
  if (isUndefined(columns) && isUndefined(relations) && isUndefined(children)) return item;
  return {
    ...item,
    columns: columns ?? item.columns,
    relations: relations ?? item.relations,
    children: children ?? item.children,
  };
}

/**
 * Gates a fresh item and its whole subtree for one parent, so `insertScope` writes it verbatim.
 * The child ancestry extends with the item's own values, ungated.
 * A deeper climb then reads the intermediate item even where a subfield gated inactive at this level.
 */
export function gateSubtree(
  item: ProcessedScope,
  subfields: Record<string, FieldQueryMeta>,
  ancestry: readonly ScopeValues[],
): ProcessedScope {
  const gated = gateNested(item, subfields, ancestry);
  const childAncestry = [...ancestry, item.values];
  return {
    ...gated,
    children: gated.children.map((child) => ({
      ...child,
      items: child.items.map((sub) =>
        gateSubtree(sub, child.meta.subfields as Record<string, FieldQueryMeta>, childAncestry),
      ),
    })),
  };
}
