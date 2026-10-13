import type { ConditionObject, ConditionValue } from '../../utils/index.ts';

import {
  isArray,
  isBoolean,
  isEmpty,
  isNumber,
  isPlainObject,
  isString,
  isUndefined,
} from '../../utils/index.ts';

/**
 * The friendly filter operators the builder offers.
 * `contains`, `startsWith`, and `endsWith` are single operators without a case toggle.
 * `includes` and `notIncludes` probe the entries of a JSON-list field.
 */
export type FilterOperator =
  | 'eq'
  | 'ne'
  | 'lt'
  | 'lte'
  | 'gt'
  | 'gte'
  | 'startsWith'
  | 'endsWith'
  | 'contains'
  | 'notContains'
  | 'includes'
  | 'notIncludes';

/**
 * The value a filter condition compares: what the built `where` carries for one rule.
 */
export type FilterValue = string | number | boolean;

/**
 * One filter rule: a field compared to a value through a friendly operator.
 */
export interface FilterCondition {
  /**
   * The reconciliation key, unique within the tree; never part of the emitted `where`.
   */
  key: string;

  /**
   * The field name the rule compares, or a dotted path through one-child composites, like `period.start`.
   */
  field: string;

  /**
   * The friendly operator; `filterToWhere` maps it onto ohne's condition grammar.
   */
  operator: FilterOperator;

  /**
   * The compared value, typed by the field's own filter.
   */
  value: FilterValue;
}

/**
 * A nested group of rules joined by one relation.
 */
export interface FilterGroup {
  /**
   * The reconciliation key, unique within the tree; never part of the emitted `where`.
   */
  key: string;

  /**
   * Whether the group's members must all match (`and`) or any may match (`or`).
   */
  relation: 'and' | 'or';

  /**
   * The group's members, conditions and nested groups alike.
   */
  items: FilterNode[];
}

/**
 * One node of the filter tree.
 */
export type FilterNode = FilterCondition | FilterGroup;

/**
 * The whole filter model the builder edits: top-level members under one relation.
 */
export interface FilterModel {
  /**
   * The relation joining the top-level members.
   */
  relation: 'and' | 'or';

  /**
   * The top-level members.
   */
  items: FilterNode[];
}

const OHNE_OPERATORS: Record<
  Exclude<FilterOperator, 'ne' | 'notContains' | 'notIncludes'>,
  | 'equalsTo'
  | 'lessThan'
  | 'atMost'
  | 'greaterThan'
  | 'atLeast'
  | 'startsWith'
  | 'endsWith'
  | 'contains'
  | 'includes'
> = {
  eq: 'equalsTo',
  lt: 'lessThan',
  lte: 'atMost',
  gt: 'greaterThan',
  gte: 'atLeast',
  startsWith: 'startsWith',
  endsWith: 'endsWith',
  contains: 'contains',
  includes: 'includes',
};

const FRIENDLY_OPERATORS: Record<
  string,
  Exclude<FilterOperator, 'ne' | 'notContains' | 'notIncludes'>
> = {
  equalsTo: 'eq',
  lessThan: 'lt',
  atMost: 'lte',
  greaterThan: 'gt',
  atLeast: 'gte',
  startsWith: 'startsWith',
  endsWith: 'endsWith',
  contains: 'contains',
  includes: 'includes',
};

const NEGATED_OPERATORS: Partial<Record<FilterOperator, FilterOperator>> = {
  eq: 'ne',
  contains: 'notContains',
  includes: 'notIncludes',
};

const PATTERN_OPERATORS: ReadonlySet<FilterOperator> = new Set([
  'startsWith',
  'endsWith',
  'contains',
  'notContains',
]);

let sequence = 0;

/**
 * A fresh reconciliation key for one filter node.
 *
 * @example
 * ```ts
 * filterKey() !== filterKey() // -> true
 * ```
 */
export function filterKey(): string {
  return `f${++sequence}`;
}

/**
 * Serializes the filter model into the `where` that `POST /collections/[segment]/query` accepts.
 *
 * - `eq` emits `{ [field]: { equalsTo: value } }`.
 * - `ne` emits `{ not: { [field]: { equalsTo: value } } }`.
 * - `lt`, `lte`, `gt`, `gte` emit `lessThan`, `atMost`, `greaterThan`, `atLeast`.
 * - `startsWith`, `endsWith`, `contains` emit the same-named ohne operator.
 *   An empty string value becomes `' '`, so an unfilled pattern never matches everything.
 * - `notContains` emits `{ not: { [field]: { contains: value } } }`.
 * - `includes` emits `{ [field]: { includes: value } }`; `notIncludes` the `not`-wrapped same.
 * - A dotted `field` like `period.start` nests one `{ [composite]: { has: ... } }` per segment.
 *   A negation stays inside the innermost `has`, so a record without the composite never matches.
 * - A member list emits `{ and: [...] }` / `{ or: [...] }` with one object per member.
 *   A single member emits its object alone, and an empty group is omitted entirely.
 * - An empty model serializes to `undefined`: the query carries no `where` at all.
 *
 * @example
 * ```ts
 * filterToWhere({
 *   relation: 'and',
 *   items: [{ key: filterKey(), field: 'views', operator: 'gte', value: 10 }],
 * })
 * // -> { views: { atLeast: 10 } }
 * ```
 */
export function filterToWhere(model: FilterModel): ConditionObject | undefined {
  return serializeItems(model.relation, model.items);
}

/**
 * Rebuilds the filter model from a previously emitted `where`.
 * The round-trip covers what `filterToWhere` emits.
 * Foreign conditions the builder cannot represent, like `isNull` or a negated group, are dropped.
 *
 * @example
 * ```ts
 * const model = filterFromWhere({ views: { atLeast: 10 } })
 * model.relation // -> 'and'
 * model.items    // -> [{ key: 'f…', field: 'views', operator: 'gte', value: 10 }]
 * ```
 */
export function filterFromWhere(where: ConditionObject | undefined): FilterModel {
  if (isUndefined(where)) return { relation: 'and', items: [] };
  const keys = Object.keys(where);
  if (keys.length === 1 && keys[0] === 'or' && isArray(where.or)) {
    return { relation: 'or', items: parseBranches(where.or) };
  }
  if (keys.length === 1 && keys[0] === 'and' && isArray(where.and)) {
    return { relation: 'and', items: parseBranches(where.and) };
  }
  return { relation: 'and', items: parseObject(where) };
}

/**
 * The members joined under `relation`, a lone member unwrapped, `undefined` when none serializes.
 */
function serializeItems(
  relation: 'and' | 'or',
  items: readonly FilterNode[],
): ConditionObject | undefined {
  const members: ConditionObject[] = [];
  for (const item of items) {
    const serialized =
      'items' in item ? serializeItems(item.relation, item.items) : serializeCondition(item);
    if (!isUndefined(serialized)) members.push(serialized);
  }
  if (members.length === 0) return undefined;
  if (members.length === 1) return members[0];
  return { [relation]: members };
}

/**
 * One rule's condition object; negated operators wrap in `not`, and an empty pattern sends `' '`.
 * A dotted path nests one `has` per composite, the `not` inside the innermost one.
 */
function serializeCondition(condition: FilterCondition): ConditionObject {
  const path = condition.field.split('.');
  let where = serializeLeaf(path.pop()!, condition.operator, condition.value);
  for (const composite of path.reverse()) where = { [composite]: { has: where } };
  return where;
}

/**
 * The condition object comparing one field of the innermost scope.
 */
function serializeLeaf(
  field: string,
  operator: FilterOperator,
  value: FilterValue,
): ConditionObject {
  if (value === '' && PATTERN_OPERATORS.has(operator)) value = ' ';
  if (operator === 'ne') return { not: { [field]: { equalsTo: value } } };
  if (operator === 'notContains') return { not: { [field]: { contains: value } } };
  if (operator === 'notIncludes') return { not: { [field]: { includes: value } } };
  return { [field]: { [OHNE_OPERATORS[operator]]: value } };
}

/**
 * The nodes of an `and` or `or` list; a branch of several rules nests as an `and` group.
 */
function parseBranches(branches: readonly unknown[]): FilterNode[] {
  const items: FilterNode[] = [];
  for (const branch of branches) {
    if (!isPlainObject(branch)) continue;
    const parsed = parseObject(branch as ConditionObject);
    if (parsed.length === 1) items.push(parsed[0]!);
    else if (parsed.length > 1) items.push({ key: filterKey(), relation: 'and', items: parsed });
  }
  return items;
}

/**
 * The nodes one condition object holds, in key order; a key the builder cannot represent is dropped.
 */
function parseObject(where: ConditionObject): FilterNode[] {
  const items: FilterNode[] = [];
  for (const [key, value] of Object.entries(where)) {
    if (key === 'and' && isArray(value)) {
      items.push({ key: filterKey(), relation: 'and', items: parseBranches(value) });
    } else if (key === 'or' && isArray(value)) {
      items.push({ key: filterKey(), relation: 'or', items: parseBranches(value) });
    } else if (key === 'not') {
      const negated = parseNegated(value);
      if (!isUndefined(negated)) items.push(negated);
    } else {
      const condition = parseHas(key, value) ?? parseCompare(key, value);
      if (!isUndefined(condition)) items.push(condition);
    }
  }
  return items;
}

/**
 * The dotted rule a composite's `has` holds, or `undefined` unless its body is exactly one rule.
 * Only a field's own key reaches here, so a negated `has` never turns into a `has` of a negation.
 */
function parseHas(field: string, value: ConditionValue): FilterCondition | undefined {
  if (!isPlainObject(value)) return undefined;
  const { has, ...rest } = value as ConditionObject;
  if (!isEmpty(rest) || !isPlainObject(has)) return undefined;
  const inner = parseObject(has as ConditionObject);
  if (inner.length !== 1 || 'items' in inner[0]!) return undefined;
  return { ...inner[0]!, field: `${field}.${inner[0]!.field}` };
}

/**
 * The negated rule a `not` holds, or `undefined` unless it wraps one comparison with a negated form.
 */
function parseNegated(value: ConditionValue): FilterCondition | undefined {
  if (!isPlainObject(value)) return undefined;
  const entries = Object.entries(value as ConditionObject);
  if (entries.length !== 1) return undefined;
  const [field, comparison] = entries[0]!;
  const parsed = parseCompare(field, comparison);
  if (isUndefined(parsed)) return undefined;
  const negated = NEGATED_OPERATORS[parsed.operator];
  return isUndefined(negated) ? undefined : { ...parsed, operator: negated };
}

/**
 * The rule one field's comparison encodes, a bare scalar as `eq`; `undefined` when unrepresentable.
 */
function parseCompare(field: string, value: ConditionValue): FilterCondition | undefined {
  if (isScalar(value)) return { key: filterKey(), field, operator: 'eq', value };
  if (!isPlainObject(value)) return undefined;
  const entries = Object.entries(value as ConditionObject);
  if (entries.length !== 1) return undefined;
  const [name, operand] = entries[0]!;
  const operator = FRIENDLY_OPERATORS[name];
  if (isUndefined(operator) || !isScalar(operand)) return undefined;
  return { key: filterKey(), field, operator, value: operand };
}

/**
 * Whether an operand fits `FilterValue`, so `null`, lists, and objects never become a rule.
 */
function isScalar(value: unknown): value is FilterValue {
  return isString(value) || isNumber(value) || isBoolean(value);
}
