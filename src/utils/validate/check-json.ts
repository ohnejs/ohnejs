import type { ValidationFailure } from './validation-failure.ts';

import { isUndefined } from '../is/is-undefined.ts';
import { jsonChildren } from '../json/_json-children.ts';
import { isJSONScalar } from '../json/is-json-scalar.ts';

/**
 * Options for `checkJSON`.
 */
export interface CheckJSONOptions {
  /**
   * How deeply arrays and objects may nest: a scalar is depth 0, `[]` and `{}` are 1.
   *
   * @default
   * 32
   */
  readonly maxDepth?: number | undefined;
}

/**
 * Fails a value that is not plain JSON data as `validation.invalidJSON`, by the rules of `isJSONValue`.
 * Nesting deeper than `maxDepth` fails as `validation.maxDepth`, so a cycle fails too and never throws.
 * The walk is iterative, so no depth overflows the stack.
 *
 * @example
 * ```ts
 * checkJSON({ tags: ['a'] })        // -> undefined
 * checkJSON([[1]], { maxDepth: 1 }) // -> { key: 'validation.maxDepth', params: { max: 1 } }
 * checkJSON({ at: new Date() })     // -> 'validation.invalidJSON'
 * ```
 */
export function checkJSON(
  value: unknown,
  options: CheckJSONOptions = {},
): ValidationFailure | undefined {
  const { maxDepth = 32 } = options;
  const stack: [node: unknown, depth: number][] = [[value, 0]];
  while (stack.length > 0) {
    const [node, depth] = stack.pop()!;
    if (isJSONScalar(node)) continue;
    const children = jsonChildren(node);
    if (isUndefined(children)) return 'validation.invalidJSON';
    if (depth >= maxDepth) return { key: 'validation.maxDepth', params: { max: maxDepth } };
    for (const child of children) stack.push([child, depth + 1]);
  }
  return undefined;
}
