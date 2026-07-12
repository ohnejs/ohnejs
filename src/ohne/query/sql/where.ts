import type { CompareOperator, ConditionNode } from '../../../utils/index.ts';
import type { SQLValue } from '../../database/adapter.ts';
import type { Dialect, LogicalType } from '../../database/dialect.ts';
import type { CollectionQueryMeta } from '../metadata.ts';

import { ohneError } from '../../error/ohne-error.ts';
import { escapeLike } from './escape-like.ts';
import { inFragment, joinFragments, rawFragment, type SQLFragment } from './fragment.ts';

/**
 * Compiles a condition AST into a `WHERE`-clause fragment over a collection's main table.
 *
 * `and`/`or` groups render parenthesized and join their children; an empty group is a constant.
 * An empty `and` matches all (`1 = 1`), an empty `or` matches nothing (`1 = 0`).
 * A `compare` leaf renders its operator over the field's quoted column, negation wrapping in `NOT (...)`.
 * Comparison values pass `dialect.serialize` keyed by the column's type.
 * The text trio and `like` bind their string patterns directly.
 * Every value binds through a `?`, so nothing inlines into the SQL.
 * Relational leaves (`has`/`empty`) never reach here: metadata gating bars them on scalar fields.
 */
export function compileWhere(
  node: ConditionNode,
  meta: CollectionQueryMeta,
  dialect: Dialect,
): SQLFragment {
  switch (node.kind) {
    case 'and':
      return group(node.nodes, ' AND ', '1 = 1', meta, dialect);
    case 'or':
      return group(node.nodes, ' OR ', '1 = 0', meta, dialect);
    case 'compare': {
      const field = meta.fields[node.path[0]];
      const column = dialect.quote(field.column as string);
      const fragment = compareFragment(
        node.op,
        column,
        field.logicalType as LogicalType,
        node.value,
        dialect,
      );
      return node.negated ? { sql: `NOT (${fragment.sql})`, params: fragment.params } : fragment;
    }
    case 'has':
    case 'empty':
      throw ohneError('Relational conditions do not reach the scalar compiler');
  }
}

/**
 * Joins a group's children with `separator`, parenthesizing the result; an empty group is `constant`.
 */
function group(
  nodes: readonly ConditionNode[],
  separator: string,
  constant: string,
  meta: CollectionQueryMeta,
  dialect: Dialect,
): SQLFragment {
  if (nodes.length === 0) return rawFragment(constant);
  const fragments = nodes.map((child) => compileWhere(child, meta, dialect));
  if (fragments.length === 1) return fragments[0];
  const joined = joinFragments(fragments, separator);
  return { sql: `(${joined.sql})`, params: joined.params };
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
