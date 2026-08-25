import {
  type ConditionObject,
  type ConditionValue,
  isArray,
  isBoolean,
  isNumber,
  isPlainObject,
  isString,
  isUndefined,
} from 'ohne/utils';

/**
 * The friendly filter operators the builder offers, ported from Pruvious v4's `FilterOperator`.
 * The source's case-insensitive `*I` variants collapse away: ohne's `contains`, `startsWith`,
 * and `endsWith` are single operators without a case toggle.
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
  | 'notContains';

/**
 * The storage primitives the filter builder can compare, from `DashboardField.logicalType`.
 */
export type FilterableType = 'text' | 'integer' | 'real' | 'boolean';

/**
 * One filter rule: a column field compared to a value through a friendly operator.
 */
export interface FilterCondition {
  /**
   * The reconciliation key, unique within the tree; never part of the emitted `where`.
   */
  key: string;

  /**
   * The field name the rule compares.
   */
  field: string;

  /**
   * The friendly operator; `filterToWhere` maps it onto ohne's condition grammar.
   */
  operator: FilterOperator;

  /**
   * The compared value, typed by the field's storage primitive.
   */
  value: string | number | boolean;
}

/**
 * A nested group of rules joined by one relation, the port of the source's condition groups.
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
 * The operators one storage primitive admits, the port of the source's `getValidFilterOperators`.
 *
 * @example
 * ```ts
 * filterOperatorsFor('boolean') // -> ['eq', 'ne']
 * ```
 */
export function filterOperatorsFor(type: FilterableType): FilterOperator[] {
  if (type === 'text') return ['eq', 'ne', 'startsWith', 'endsWith', 'contains', 'notContains'];
  if (type === 'boolean') return ['eq', 'ne'];
  return ['eq', 'ne', 'lt', 'lte', 'gt', 'gte'];
}

/**
 * The value a fresh condition on one storage primitive starts with.
 *
 * @example
 * ```ts
 * filterDefaultValue('text')    // -> ''
 * filterDefaultValue('boolean') // -> false
 * ```
 */
export function filterDefaultValue(type: FilterableType): string | number | boolean {
  if (type === 'text') return '';
  if (type === 'boolean') return false;
  return 0;
}

/**
 * Serializes the filter model into the `where` shape ohne's body-query endpoint reads.
 *
 * The emitted value is a `ConditionObject`, exactly what `POST /collections/[segment]/query`
 * accepts as its `where` key. Precisely:
 *
 * - `eq` emits `{ [field]: { equalsTo: value } }`.
 * - `ne` emits `{ not: { [field]: { equalsTo: value } } }`.
 * - `lt`, `lte`, `gt`, `gte` emit `lessThan`, `atMost`, `greaterThan`, `atLeast`.
 * - `startsWith`, `endsWith`, `contains` emit the same-named ohne operator; an empty string
 *   value becomes `' '`, as in the source, so an unfilled pattern never matches everything.
 * - `notContains` emits `{ not: { [field]: { contains: value } } }`.
 * - A member list emits its single member's object alone, or `{ and: [...] }` / `{ or: [...] }`
 *   with one object per member; an empty group is omitted entirely.
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
 * Rebuilds the filter model from a previously emitted `where`, the `fromModelValue` port.
 * The round-trip covers what `filterToWhere` emits; foreign conditions the builder cannot
 * represent, like `isNull` or a negated group, are dropped.
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

const OHNE_OPERATORS: Record<
  Exclude<FilterOperator, 'ne' | 'notContains'>,
  | 'equalsTo'
  | 'lessThan'
  | 'atMost'
  | 'greaterThan'
  | 'atLeast'
  | 'startsWith'
  | 'endsWith'
  | 'contains'
> = {
  eq: 'equalsTo',
  lt: 'lessThan',
  lte: 'atMost',
  gt: 'greaterThan',
  gte: 'atLeast',
  startsWith: 'startsWith',
  endsWith: 'endsWith',
  contains: 'contains',
};

const FRIENDLY_OPERATORS: Record<string, Exclude<FilterOperator, 'ne' | 'notContains'>> = {
  equalsTo: 'eq',
  lessThan: 'lt',
  atMost: 'lte',
  greaterThan: 'gt',
  atLeast: 'gte',
  startsWith: 'startsWith',
  endsWith: 'endsWith',
  contains: 'contains',
};

const PATTERN_OPERATORS: ReadonlySet<FilterOperator> = new Set([
  'startsWith',
  'endsWith',
  'contains',
  'notContains',
]);

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

function serializeCondition(condition: FilterCondition): ConditionObject {
  const { field, operator } = condition;
  let value = condition.value;
  if (value === '' && PATTERN_OPERATORS.has(operator)) value = ' ';
  if (operator === 'ne') return { not: { [field]: { equalsTo: value } } };
  if (operator === 'notContains') return { not: { [field]: { contains: value } } };
  return { [field]: { [OHNE_OPERATORS[operator]]: value } };
}

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
      const condition = parseCompare(key, value);
      if (!isUndefined(condition)) items.push(condition);
    }
  }
  return items;
}

function parseNegated(value: ConditionValue): FilterCondition | undefined {
  if (!isPlainObject(value)) return undefined;
  const entries = Object.entries(value as ConditionObject);
  if (entries.length !== 1) return undefined;
  const [field, comparison] = entries[0]!;
  const parsed = parseCompare(field, comparison);
  if (isUndefined(parsed)) return undefined;
  if (parsed.operator === 'eq') return { ...parsed, operator: 'ne' };
  if (parsed.operator === 'contains') return { ...parsed, operator: 'notContains' };
  return undefined;
}

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

function isScalar(value: unknown): value is string | number | boolean {
  return isString(value) || isNumber(value) || isBoolean(value);
}
