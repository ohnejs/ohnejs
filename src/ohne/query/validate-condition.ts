import type { ConditionNode } from '../../utils/index.ts';
import type { CollectionQueryMeta } from './metadata.ts';

import { didYouMean, isUndefined } from '../../utils/index.ts';
import { ohneError } from '../error/ohne-error.ts';
import { allowedOperators, type QueryOperator } from './operators.ts';

/**
 * Gates a parsed condition against a collection's metadata, the runtime twin of the type-level narrowing.
 *
 * Every leaf must address a real field and apply an operator that field admits.
 * An unknown field throws, with a `didYouMean` suggestion when one is close.
 * An inapplicable operator throws, naming the field and the operator.
 * A `where` path is a single segment in v1: an anchored or dotted path reads as an unknown field.
 * Untyped callers thus hit the same failures the typed surface prevents at compile time.
 */
export function validateCondition(node: ConditionNode, meta: CollectionQueryMeta): void {
  if (node.kind === 'and' || node.kind === 'or') {
    for (const child of node.nodes) validateCondition(child, meta);
    return;
  }
  const operator: QueryOperator = node.kind === 'compare' ? node.op : node.kind;
  if (node.path.length !== 1) throw unknownFieldError(node.path.join('.'), meta);
  const field = meta.fields[node.path[0]];
  if (isUndefined(field)) throw unknownFieldError(node.path[0], meta);
  if (!allowedOperators(field).has(operator)) {
    throw ohneError({
      title: `Operator \`${operator}\` does not apply to \`${node.path[0]}\``,
      body: [
        `Field \`${node.path[0]}\` on collection \`${meta.collection}\` does not support \`${operator}\`.`,
      ],
    });
  }
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
