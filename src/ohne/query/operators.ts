import type { CompareOperator } from '../../utils/index.ts';
import type { FieldQueryMeta } from './metadata.ts';

/**
 * The closed operator vocabulary: wire spelling = method name = object key.
 * The compare operators come from the condition grammar; `has` and `empty` are its node kinds.
 * `not` negates any of them and is a namespace, never a suffixed operator name.
 */
export type QueryOperator = CompareOperator | 'has' | 'empty';

/**
 * The operators one field admits, read from its whole metadata entry.
 *
 * The `UUID` entries (`id` marker) take the identity tests alone.
 * A `record` takes identity tests, `isNull` when nullable, and the relation pair `has`/`empty`.
 * A UUID-typed foreign key never gains the text trio or ordering.
 * `records` and the child kinds take `has`/`empty` only.
 * `childOne` gets nothing null-related, since `empty` covers it.
 * Scalar groups gate on the column's logical type.
 * `equalsTo` admits `text`/`integer`/`boolean`; `in` and ordering admit `text`/`integer`.
 * The text trio and `like` admit `text` alone.
 * `isNull` requires nullability or a companion column.
 * A missing translation reads `null` whatever the option says.
 * `includes*` requires a column flagged `jsonList`.
 */
export function allowedOperators(meta: FieldQueryMeta): ReadonlySet<QueryOperator> {
  const nullable = meta.nullable || meta.companion === true;
  if (meta.id === true) return new Set<QueryOperator>(['equalsTo', 'in']);
  if (meta.kind === 'record') {
    return new Set<QueryOperator>([
      'equalsTo',
      'in',
      ...(nullable ? (['isNull'] as const) : []),
      'has',
      'empty',
    ]);
  }
  if (meta.kind !== 'column') return new Set<QueryOperator>(['has', 'empty']);

  const operators: QueryOperator[] = [];
  const type = meta.logicalType;
  if (type === 'text' || type === 'integer' || type === 'boolean') operators.push('equalsTo');
  if (type === 'text' || type === 'integer') {
    operators.push('in', 'greaterThan', 'atLeast', 'lessThan', 'atMost');
  }
  if (type === 'text') operators.push('contains', 'startsWith', 'endsWith', 'like');
  if (nullable) operators.push('isNull');
  if (meta.jsonList === true) operators.push('includes', 'includesAll', 'includesAny');
  return new Set(operators);
}
