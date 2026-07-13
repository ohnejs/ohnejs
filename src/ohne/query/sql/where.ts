import type { CompareOperator, ConditionNode } from '../../../utils/index.ts';
import type { SQLValue } from '../../database/adapter.ts';
import type { Dialect, LogicalType } from '../../database/dialect.ts';
import type { CollectionQueryMeta, FieldQueryMeta } from '../metadata.ts';

import { isNull } from '../../../utils/index.ts';
import { ohneError } from '../../error/ohne-error.ts';
import { queryMetadata } from '../metadata.ts';
import { escapeLike } from './escape-like.ts';
import { inFragment, joinFragments, rawFragment, type SQLFragment } from './fragment.ts';

/**
 * A condition scope: the fields a leaf may address and how their columns are referenced.
 *
 * `self` is the quoted identifier a correlated child subquery references this scope's columns by.
 * It is the main table name at the top level, a `_subN` alias inside an `EXISTS`.
 * `qualified` is whether this scope's own leaves prefix their columns with `self`.
 * The top-level `WHERE` reads bare columns (one table in `FROM`); a subquery qualifies by its alias.
 */
interface WhereScope {
  fields: Record<string, FieldQueryMeta>;
  self: string;
  qualified: boolean;
}

/**
 * The per-compile alias counter, handing every `EXISTS` subquery a fresh `_subN`.
 * One counter threads the whole tree, so nested and self-referential relations never share an alias.
 */
interface AliasCounter {
  n: number;
}

/**
 * Compiles a condition AST into a `WHERE`-clause fragment over a collection's main table.
 *
 * `and`/`or` groups render parenthesized and join their children; an empty group is a constant.
 * An empty `and` matches all (`1 = 1`), an empty `or` matches nothing (`1 = 0`) - the one place both render.
 * A `compare` leaf renders its operator over the field's column.
 * `has`/`empty` render correlated `EXISTS` subqueries per kind, aliased `_subN` from one counter.
 * Negation wraps the positive fragment in `NOT (...)`; parsing already folded `not` groups by De Morgan.
 * Every value binds through a `?`, so nothing inlines into the SQL.
 */
export function compileWhere(
  node: ConditionNode,
  meta: CollectionQueryMeta,
  dialect: Dialect,
): SQLFragment {
  const scope: WhereScope = {
    fields: meta.fields,
    self: dialect.quote(meta.table),
    qualified: false,
  };
  return compileNode(node, scope, dialect, { n: 0 });
}

/**
 * Compiles one AST node within `scope`, drawing subquery aliases from the shared `counter`.
 */
function compileNode(
  node: ConditionNode,
  scope: WhereScope,
  dialect: Dialect,
  counter: AliasCounter,
): SQLFragment {
  switch (node.kind) {
    case 'and':
      return group(node.nodes, ' AND ', '1 = 1', scope, dialect, counter);
    case 'or':
      return group(node.nodes, ' OR ', '1 = 0', scope, dialect, counter);
    case 'compare': {
      const field = scope.fields[node.path[0]];
      const column = columnRef(scope, field.column as string, dialect);
      const fragment = compareFragment(
        node.op,
        column,
        field.logicalType as LogicalType,
        node.value,
        dialect,
      );
      return negateIf(node.negated, fragment);
    }
    case 'has':
      return negateIf(node.negated, compileHas(node, scope, dialect, counter));
    case 'empty':
      return negateIf(node.negated, compileEmpty(node, scope, dialect, counter));
  }
}

/**
 * Joins a group's children with `separator`, parenthesizing the result; an empty group is `constant`.
 */
function group(
  nodes: readonly ConditionNode[],
  separator: string,
  constant: string,
  scope: WhereScope,
  dialect: Dialect,
  counter: AliasCounter,
): SQLFragment {
  if (nodes.length === 0) return rawFragment(constant);
  const fragments = nodes.map((child) => compileNode(child, scope, dialect, counter));
  if (fragments.length === 1) return fragments[0];
  const joined = joinFragments(fragments, separator);
  return { sql: `(${joined.sql})`, params: joined.params };
}

/**
 * References a column of `scope`: bare at the top level, prefixed with the scope's alias inside a subquery.
 */
function columnRef(scope: WhereScope, column: string, dialect: Dialect): string {
  const quoted = dialect.quote(column);
  return scope.qualified ? `${scope.self}.${quoted}` : quoted;
}

/**
 * References this scope's identity column for a child subquery's correlation predicate.
 */
function selfUUID(scope: WhereScope, dialect: Dialect): string {
  return `${scope.self}.${dialect.quote('UUID')}`;
}

/**
 * Wraps `fragment` in `NOT (...)` when the leaf is negated, leaving it untouched otherwise.
 */
function negateIf(negated: boolean, fragment: SQLFragment): SQLFragment {
  return negated ? { sql: `NOT (${fragment.sql})`, params: fragment.params } : fragment;
}

/**
 * Compiles `has` per relation kind: a record's non-null foreign key, or an `EXISTS` over the relation.
 * A bare `record` `has` is its foreign key being set; a conditioned one probes the target row.
 */
function compileHas(
  node: Extract<ConditionNode, { kind: 'has' }>,
  scope: WhereScope,
  dialect: Dialect,
  counter: AliasCounter,
): SQLFragment {
  const field = scope.fields[node.path[0]];
  if (field.kind === 'record') {
    if (isNull(node.condition)) {
      return rawFragment(`${columnRef(scope, field.column as string, dialect)} IS NOT NULL`);
    }
    return recordExists(field, scope, node.condition, dialect, counter);
  }
  if (field.kind === 'records')
    return recordsExists(field, scope, node.condition, dialect, counter);
  return childExists(field, scope, node.condition, dialect, counter);
}

/**
 * Compiles `empty` per relation kind: a record's null foreign key, or the negation of the relation's `EXISTS`.
 */
function compileEmpty(
  node: Extract<ConditionNode, { kind: 'empty' }>,
  scope: WhereScope,
  dialect: Dialect,
  counter: AliasCounter,
): SQLFragment {
  const field = scope.fields[node.path[0]];
  if (field.kind === 'record') {
    return rawFragment(`${columnRef(scope, field.column as string, dialect)} IS NULL`);
  }
  const existence =
    field.kind === 'records'
      ? recordsExists(field, scope, null, dialect, counter)
      : childExists(field, scope, null, dialect, counter);
  return { sql: `NOT ${existence.sql}`, params: existence.params };
}

/**
 * `EXISTS` over a `record`'s target, correlating the target's `UUID` to the parent's foreign key.
 */
function recordExists(
  field: FieldQueryMeta,
  scope: WhereScope,
  condition: ConditionNode,
  dialect: Dialect,
  counter: AliasCounter,
): SQLFragment {
  const alias = dialect.quote(nextAlias(counter));
  const target = queryMetadata(field.target as string);
  const from = `${dialect.quote(target.table)} ${alias}`;
  const correlation = `${alias}.${dialect.quote('UUID')} = ${scope.self}.${dialect.quote(field.column as string)}`;
  const inner: WhereScope = { fields: target.fields, self: alias, qualified: true };
  return existsFragment(from, correlation, condition, inner, dialect, counter);
}

/**
 * `EXISTS` over a `records` junction, correlating the parent-side link to the parent's `UUID`.
 * A conditioned probe joins the target table so the nested condition can address it.
 * The inverse side swaps which junction column links the parent and which links the target.
 */
function recordsExists(
  field: FieldQueryMeta,
  scope: WhereScope,
  condition: ConditionNode | null,
  dialect: Dialect,
  counter: AliasCounter,
): SQLFragment {
  const junction = dialect.quote(nextAlias(counter));
  const [parentLink, targetLink] =
    field.inverse === true ? ['_targetUUID', '_parentUUID'] : ['_parentUUID', '_targetUUID'];
  const correlation = `${junction}.${dialect.quote(parentLink)} = ${selfUUID(scope, dialect)}`;
  const junctionFrom = `${dialect.quote(field.table as string)} ${junction}`;
  if (isNull(condition)) {
    return rawFragment(`EXISTS (SELECT 1 FROM ${junctionFrom} WHERE ${correlation})`);
  }
  const targetAlias = dialect.quote(nextAlias(counter));
  const target = queryMetadata(field.target as string);
  const join = `JOIN ${dialect.quote(target.table)} ${targetAlias} ON ${targetAlias}.${dialect.quote('UUID')} = ${junction}.${dialect.quote(targetLink)}`;
  const inner: WhereScope = { fields: target.fields, self: targetAlias, qualified: true };
  const cond = compileNode(condition, inner, dialect, counter);
  return {
    sql: `EXISTS (SELECT 1 FROM ${junctionFrom} ${join} WHERE ${correlation} AND ${cond.sql})`,
    params: cond.params,
  };
}

/**
 * `EXISTS` over a composite's child table, correlating the child's `_parentUUID` to the parent's `UUID`.
 */
function childExists(
  field: FieldQueryMeta,
  scope: WhereScope,
  condition: ConditionNode | null,
  dialect: Dialect,
  counter: AliasCounter,
): SQLFragment {
  const alias = dialect.quote(nextAlias(counter));
  const from = `${dialect.quote(field.table as string)} ${alias}`;
  const correlation = `${alias}.${dialect.quote('_parentUUID')} = ${selfUUID(scope, dialect)}`;
  const inner: WhereScope = {
    fields: field.subfields as Record<string, FieldQueryMeta>,
    self: alias,
    qualified: true,
  };
  return existsFragment(from, correlation, condition, inner, dialect, counter);
}

/**
 * Assembles an `EXISTS (SELECT 1 FROM ... WHERE <correlation> [AND <condition>])` fragment.
 * A `null` condition tests bare existence; otherwise the condition compiles within `inner`.
 */
function existsFragment(
  from: string,
  correlation: string,
  condition: ConditionNode | null,
  inner: WhereScope,
  dialect: Dialect,
  counter: AliasCounter,
): SQLFragment {
  if (isNull(condition)) {
    return rawFragment(`EXISTS (SELECT 1 FROM ${from} WHERE ${correlation})`);
  }
  const cond = compileNode(condition, inner, dialect, counter);
  return {
    sql: `EXISTS (SELECT 1 FROM ${from} WHERE ${correlation} AND ${cond.sql})`,
    params: cond.params,
  };
}

/**
 * Hands out the next `_subN` alias, bumping the shared counter.
 */
function nextAlias(counter: AliasCounter): string {
  return `_sub${counter.n++}`;
}

/**
 * Compiles one operator over an already-quoted column into its positive fragment.
 */
function compareFragment(
  op: CompareOperator,
  column: string,
  type: LogicalType,
  value: unknown,
  dialect: Dialect,
): SQLFragment {
  switch (op) {
    case 'equalsTo':
      return { sql: `${column} = ?`, params: [dialect.serialize(type, value)] };
    case 'in':
      return inFragment(
        column,
        (value as unknown[]).map((item) => dialect.serialize(type, item)),
      );
    case 'greaterThan':
      return { sql: `${column} > ?`, params: [dialect.serialize(type, value)] };
    case 'atLeast':
      return { sql: `${column} >= ?`, params: [dialect.serialize(type, value)] };
    case 'lessThan':
      return { sql: `${column} < ?`, params: [dialect.serialize(type, value)] };
    case 'atMost':
      return { sql: `${column} <= ?`, params: [dialect.serialize(type, value)] };
    case 'contains':
      return { sql: dialect.textMatch(column), params: [`%${escapeLike(value as string)}%`] };
    case 'startsWith':
      return { sql: dialect.textMatch(column), params: [`${escapeLike(value as string)}%`] };
    case 'endsWith':
      return { sql: dialect.textMatch(column), params: [`%${escapeLike(value as string)}`] };
    case 'like':
      return { sql: `${column} LIKE ?`, params: [value as SQLValue] };
    case 'isNull':
      return { sql: `${column} IS NULL`, params: [] };
    case 'includes':
    case 'includesAll':
    case 'includesAny':
      throw ohneError('List-membership operators do not reach the scalar compiler');
  }
}
