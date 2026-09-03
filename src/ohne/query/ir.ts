import type { ConditionNode } from '../../utils/index.ts';

import { hasKey, isArray, isEmpty, isNull } from '../../utils/index.ts';

/**
 * A sort direction: ascending or descending.
 */
export type OrderDirection = 'asc' | 'desc';

/**
 * One `order` key: the field to sort by and its direction.
 */
export interface OrderEntry {
  /**
   * The field name, resolved to its column at compile time.
   */
  field: string;

  /**
   * The sort direction.
   */
  direction: OrderDirection;
}

/**
 * One node of the populate tree: a relation field, its subselect, and its own nested populates.
 * A bare `populate('author')` is `{ field: 'author', select: null, children: [] }`.
 */
export interface PopulateNode {
  /**
   * The relation field this node hydrates.
   */
  field: string;

  /**
   * The target fields the hydrated records carry, exactly, or `null` for the whole record.
   */
  select: readonly string[] | null;

  /**
   * The target's own populated relations, one level further down.
   */
  children: readonly PopulateNode[];
}

/**
 * The read reach of one collection a wire query crosses into.
 * `false` reaches nothing: a populate hydrates no target and a conditioned `has` matches no row.
 * A scope ANDs its `condition` into the target read and bounds the fields a populate carries by `select`.
 */
export type TargetReach =
  | false
  | { readonly condition: ConditionNode | null; readonly select: readonly string[] | null };

/**
 * The untrusted half of a wire read: the request's own condition and its reach into every crossed collection.
 * The condition compiles under the reach, so a conditioned `has` reads only what its target admits.
 */
export interface WireReach {
  /**
   * The request's `where`, or `null` when it names none.
   */
  condition: ConditionNode | null;

  /**
   * The reach into every collection the request populates or probes, keyed by collection name.
   */
  reach: ReadonlyMap<string, TargetReach>;
}

/**
 * The immutable snapshot a terminal compiles and executes from.
 *
 * A builder accumulates plain state and freezes it into this shape when a terminal runs.
 * Compiling and executing never mutate it; `paginate` composes `count` and the row read from one snapshot.
 * `condition` is the AND of every accumulated `where`; `select` is `null` when no field was narrowed.
 */
export interface QueryIR {
  /**
   * The collection being read.
   */
  collection: string;

  /**
   * The accumulated condition, or `null` when the query is unfiltered.
   */
  condition: ConditionNode | null;

  /**
   * The narrowed top-level fields, or `null` for the full record.
   */
  select: readonly string[] | null;

  /**
   * The stacked sort keys, in priority order.
   */
  order: readonly OrderEntry[];

  /**
   * The row cap, or `null` for no cap.
   */
  limit: number | null;

  /**
   * The row offset, or `null` for none.
   */
  offset: number | null;

  /**
   * The populate tree: one root node per relation to hydrate, each carrying its own subtree.
   */
  populate: readonly PopulateNode[];

  /**
   * The explicit `.locale()` choice, or `null` for the default locale.
   * Every locale-scoped table access resolves it through `effectiveLocale`.
   */
  locale: string | null;

  /**
   * A wire read's untrusted condition and reach, or `null` on a trusted read.
   */
  wire: WireReach | null;
}

/**
 * Freezes builder state into an immutable `QueryIR`, folding the accumulated conditions into one node.
 * Sibling conditions AND together; an empty set is `null`, a single condition stands alone.
 * Every subtree freezes as a copy - condition, order, populate, wire.
 * Mutating the IR therefore throws at any depth.
 * The reach map is read-only by type; its entries freeze as copies like everything else.
 */
export function freezeIR(state: {
  collection: string;
  conditions: readonly ConditionNode[];
  select: readonly string[] | null;
  order: readonly OrderEntry[];
  limit: number | null;
  offset: number | null;
  populate: readonly PopulateNode[];
  locale: string | null;
  wire: WireReach | null;
}): QueryIR {
  const condition = isEmpty(state.conditions)
    ? null
    : state.conditions.length === 1
      ? freezeConditionNode(state.conditions[0])
      : Object.freeze({
          kind: 'and' as const,
          nodes: Object.freeze(state.conditions.map(freezeConditionNode)),
        });
  return Object.freeze({
    collection: state.collection,
    condition,
    select: isNull(state.select) ? null : Object.freeze([...state.select]),
    order: Object.freeze(state.order.map(freezeOrderEntry)),
    limit: state.limit,
    offset: state.offset,
    populate: Object.freeze(state.populate.map(freezePopulateNode)),
    locale: state.locale,
    wire: isNull(state.wire)
      ? null
      : Object.freeze({
          condition: isNull(state.wire.condition)
            ? null
            : freezeConditionNode(state.wire.condition),
          reach: freezeReach(state.wire.reach),
        }),
  });
}

/**
 * Every condition a read applies: its trusted condition ANDed with a wire read's own.
 * For deciding a statement's shape; the compiler keeps the two apart to scope the wire half.
 */
export function readCondition(ir: QueryIR): ConditionNode | null {
  const wire = isNull(ir.wire) ? null : ir.wire.condition;
  if (isNull(ir.condition)) return wire;
  if (isNull(wire)) return ir.condition;
  return { kind: 'and', nodes: [ir.condition, wire] };
}

/**
 * Deep-freezes one condition node: its path, its value list, its children recursively, and the node itself.
 * Copies rather than freezing in place, so the builder's own accumulated nodes stay untouched.
 */
function freezeConditionNode(node: ConditionNode): ConditionNode {
  switch (node.kind) {
    case 'and':
    case 'or':
      return Object.freeze({
        kind: node.kind,
        nodes: Object.freeze(node.nodes.map(freezeConditionNode)),
      });
    case 'has':
      return Object.freeze({
        kind: node.kind,
        path: Object.freeze([...node.path]),
        condition: isNull(node.condition) ? null : freezeConditionNode(node.condition),
        negated: node.negated,
      });
    case 'empty':
      return Object.freeze({
        kind: node.kind,
        path: Object.freeze([...node.path]),
        negated: node.negated,
      });
    case 'compare':
      return Object.freeze({
        kind: node.kind,
        path: Object.freeze([...node.path]),
        op: node.op,
        ...(hasKey(node, 'value')
          ? { value: isArray(node.value) ? Object.freeze([...node.value]) : node.value }
          : {}),
        negated: node.negated,
      });
  }
}

/**
 * Freezes one order entry as a copy, so the builder's own entry stays untouched.
 */
function freezeOrderEntry(entry: OrderEntry): OrderEntry {
  return Object.freeze({ field: entry.field, direction: entry.direction });
}

/**
 * Deep-freezes one populate node: its subselect, its children recursively, and the node itself.
 */
function freezePopulateNode(node: PopulateNode): PopulateNode {
  return Object.freeze({
    field: node.field,
    select: isNull(node.select) ? null : Object.freeze([...node.select]),
    children: Object.freeze(node.children.map(freezePopulateNode)),
  });
}

/**
 * Freezes each reach entry as a copy, so a frozen IR holds no target scope a caller could still edit.
 */
function freezeReach(reach: ReadonlyMap<string, TargetReach>): ReadonlyMap<string, TargetReach> {
  const frozen = new Map<string, TargetReach>();
  for (const [collection, entry] of reach) {
    frozen.set(
      collection,
      entry === false
        ? false
        : Object.freeze({
            condition: isNull(entry.condition) ? null : freezeConditionNode(entry.condition),
            select: isNull(entry.select) ? null : Object.freeze([...entry.select]),
          }),
    );
  }
  return frozen;
}
