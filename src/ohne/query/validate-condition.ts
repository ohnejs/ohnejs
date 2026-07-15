import type { ConditionNode } from '../../utils/index.ts';
import type { CollectionQueryMeta, FieldQueryMeta } from './metadata.ts';

import { didYouMean, isNull, isUndefined } from '../../utils/index.ts';
import { ohneError } from '../error/ohne-error.ts';
import { queryMetadata } from './metadata.ts';
import { allowedOperators, type QueryOperator } from './operators.ts';

/**
 * A single applicability failure a condition leaf carries, the shape both callers render.
 *
 * The fluent path throws it as an `ohneError` naming the field.
 * The wire path collapses both kinds into one `invalidField`, so a URL cannot probe which fields exist.
 */
export interface ConditionProblem {
  /**
   * Whether the field is unknown, or is real but rejects the operator.
   */
  kind: 'unknownField' | 'inapplicable';

  /**
   * The offending field, as addressed: a single segment, or the joined path of a multi-segment one.
   */
  field: string;

  /**
   * The operator the leaf applied, `has`/`empty` included (they read as operators here).
   */
  operator: QueryOperator;

  /**
   * The scope the field was looked up in, carrying the collection name and the candidate fields.
   */
  scope: CollectionQueryMeta;

  /**
   * The path from the condition root to the leaf, `has` boundaries included, for the wire dot path.
   */
  path: readonly string[];

  /**
   * The closest real field when the name is a near miss, for a `did you mean` hint. Absent otherwise.
   */
  suggestion: string | undefined;
}

/**
 * Walks a parsed condition against a collection's metadata, returning the first applicability failure.
 *
 * Every leaf must address a real field and apply an operator that field admits.
 * A `has`'s nested condition re-scopes to the relation's target and is walked there in turn.
 * Its field name pushes onto the returned `path`, so the failure locates itself from the root.
 * A `where` path is a single segment in v1: an anchored or dotted path reads as an unknown field.
 * Returns `null` when every leaf is sound.
 */
export function checkCondition(
  node: ConditionNode,
  meta: CollectionQueryMeta,
  prefix: readonly string[] = [],
): ConditionProblem | null {
  if (node.kind === 'and' || node.kind === 'or') {
    for (const child of node.nodes) {
      const problem = checkCondition(child, meta, prefix);
      if (!isNull(problem)) return problem;
    }
    return null;
  }
  const operator: QueryOperator = node.kind === 'compare' ? node.op : node.kind;
  if (node.path.length !== 1) {
    const field = node.path.join('.');
    return {
      kind: 'unknownField',
      field,
      operator,
      scope: meta,
      path: [...prefix, field],
      suggestion: undefined,
    };
  }
  const name = node.path[0];
  const field = meta.fields[name];
  if (isUndefined(field)) {
    const suggestion = didYouMean(name, Object.keys(meta.fields));
    return {
      kind: 'unknownField',
      field: name,
      operator,
      scope: meta,
      path: [...prefix, name],
      suggestion,
    };
  }
  if (!allowedOperators(field).has(operator)) {
    return {
      kind: 'inapplicable',
      field: name,
      operator,
      scope: meta,
      path: [...prefix, name],
      suggestion: undefined,
    };
  }
  if (node.kind === 'has' && !isNull(node.condition)) {
    return checkCondition(node.condition, targetScope(field, name, meta), [...prefix, name]);
  }
  return null;
}

/**
 * Gates a parsed condition against a collection's metadata, the runtime twin of the type-level narrowing.
 *
 * Every leaf must address a real field and apply an operator that field admits.
 * An unknown field throws, with a `didYouMean` suggestion when one is close.
 * An inapplicable operator throws, naming the field and the operator.
 * A `has`'s nested condition re-scopes to the relation's target and is gated there in turn.
 * A `where` path is a single segment in v1: an anchored or dotted path reads as an unknown field.
 * Untyped callers thus hit the same failures the typed surface prevents at compile time.
 */
export function validateCondition(node: ConditionNode, meta: CollectionQueryMeta): void {
  const problem = checkCondition(node, meta);
  if (isNull(problem)) return;
  if (problem.kind === 'unknownField') throw unknownFieldError(problem.field, problem.scope);
  throw ohneError({
    title: `Operator \`${problem.operator}\` does not apply to \`${problem.field}\``,
    body: [
      `Field \`${problem.field}\` on collection \`${problem.scope.collection}\` does not support \`${problem.operator}\`.`,
    ],
  });
}

/**
 * The metadata a `has`'s nested condition is gated against, resolved by the field's kind.
 * A relation names its target collection; a child kind gets a synthetic scope over its subfields.
 */
export function targetScope(
  field: FieldQueryMeta,
  name: string,
  meta: CollectionQueryMeta,
): CollectionQueryMeta {
  if (field.kind === 'record' || field.kind === 'records') {
    return queryMetadata(field.target as string);
  }
  return {
    collection: `${meta.collection}.${name}`,
    table: field.table as string,
    fields: field.subfields as Record<string, FieldQueryMeta>,
  };
}

/**
 * Builds the unknown-field failure for `name`, suggesting the closest real field when one is near.
 * Shared by condition gating and by `select`/`orderBy`, so every unknown field reads the same way.
 */
export function unknownFieldError(
  name: string,
  meta: CollectionQueryMeta,
): ReturnType<typeof ohneError> {
  const suggestion = didYouMean(name, Object.keys(meta.fields));
  return ohneError({
    title: `Unknown field \`${name}\` on \`${meta.collection}\``,
    body: isUndefined(suggestion)
      ? [`Collection \`${meta.collection}\` has no field \`${name}\`.`]
      : [
          `Collection \`${meta.collection}\` has no field \`${name}\`. Did you mean \`${suggestion}\`?`,
        ],
  });
}
