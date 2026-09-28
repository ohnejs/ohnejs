import type { MessageAST, MessageNode } from './message-ast.ts';

import { uniqueArray } from '../array/unique-array.ts';
import { isNull } from '../is/is-null.ts';
import { isUndefined } from '../is/is-undefined.ts';
import { hasKey } from '../object/has-key.ts';
import { parseMessage } from './parse-message.ts';

/**
 * The TypeScript type of one message parameter, inferred from how an ICU template uses it.
 * Each kind stands for a concrete annotation:
 *
 * - `value`  -> `string | number` (a plain `{name}` placeholder)
 * - `number` -> `number` (`{n, number}`, `{n, plural}`, `{n, selectordinal}`)
 * - `date`   -> `Date | number` (`{d, date}`, `{d, time}`)
 * - `choice` -> a union of its `options` literals (`{g, select, a {} b {} other {}}` -> `'a' | 'b'`)
 */
export type MessageParamType =
  | { readonly kind: 'value' }
  | { readonly kind: 'number' }
  | { readonly kind: 'date' }
  | { readonly kind: 'choice'; readonly options: readonly string[] };

/**
 * Maps each parameter name in an ICU template to its inferred `MessageParamType`.
 * Convenience over `parseMessage` + `messageParamTypesAST`; parses on every call.
 * Throws `MessageSyntaxError` on a malformed template.
 *
 * A name used in several roles is narrowed to the type that satisfies every use.
 * `{min}` (a `value`) combined with `{min, plural, ...}` (a `number`) resolves to `number`.
 * A name used as both a `select` and a `number`/`date` has no common type and is rejected.
 *
 * @example
 * ```ts
 * messageParamTypes('Hi {name}')
 * // -> { name: { kind: 'value' } }
 *
 * messageParamTypes('{n, plural, one {# item} other {# items}}')
 * // -> { n: { kind: 'number' } }
 *
 * messageParamTypes('Must be {min} {min, plural, one {x} other {y}}')
 * // -> { min: { kind: 'number' } }
 *
 * messageParamTypes('{g, select, female {she} male {he} other {they}}')
 * // -> { g: { kind: 'choice', options: ['female', 'male'] } }
 * ```
 */
export function messageParamTypes(template: string): Record<string, MessageParamType> {
  return messageParamTypesAST(parseMessage(template));
}

/**
 * Walks a parsed `MessageAST` and returns one `MessageParamType` per parameter name.
 * The AST form of `messageParamTypes`; use it when the template is already parsed.
 *
 * @example
 * ```ts
 * messageParamTypesAST(parseMessage('{n, number}')) // -> { n: { kind: 'number' } }
 * ```
 */
export function messageParamTypesAST(ast: MessageAST): Record<string, MessageParamType> {
  const params: Record<string, MessageParamType> = {};
  walk(ast, params);
  return params;
}

/**
 * Unifies the parameter types of two templates meant to take the same parameters.
 * Each name is narrowed to the type that satisfies both, as one template's repeated uses are.
 * Returns `null` when the two name different parameters, or a name has no common type.
 *
 * @example
 * ```ts
 * unifyMessageParamTypes({ n: { kind: 'value' } }, { n: { kind: 'number' } })
 * // -> { n: { kind: 'number' } }
 *
 * unifyMessageParamTypes({ n: { kind: 'value' } }, { count: { kind: 'value' } })
 * // -> null
 * ```
 */
export function unifyMessageParamTypes(
  a: Readonly<Record<string, MessageParamType>>,
  b: Readonly<Record<string, MessageParamType>>,
): Record<string, MessageParamType> | null {
  const names = Object.keys(a);
  if (names.length !== Object.keys(b).length) return null;

  const unified: Record<string, MessageParamType> = {};
  for (const name of names) {
    const merged = hasKey(b, name) ? narrow(a[name]!, b[name]!) : null;
    if (isNull(merged)) return null;
    unified[name] = merged;
  }
  return unified;
}

/**
 * Records into `params` the type each node in `nodes` implies.
 */
function walk(nodes: MessageAST, params: Record<string, MessageParamType>): void {
  for (const node of nodes) walkNode(node, params);
}

/**
 * Records the type one node implies for its parameter, then walks plural and select case bodies.
 */
function walkNode(node: MessageNode, params: Record<string, MessageParamType>): void {
  switch (node.kind) {
    case 'literal':
    case 'pound':
      return;

    case 'argument':
      record(params, node.name, { kind: 'value' });
      return;

    case 'number':
      record(params, node.name, { kind: 'number' });
      return;

    case 'date':
    case 'time':
      record(params, node.name, { kind: 'date' });
      return;

    case 'plural':
      record(params, node.name, { kind: 'number' });
      for (const c of node.cases) walk(c.body, params);
      return;

    case 'select':
      record(params, node.name, {
        kind: 'choice',
        options: node.cases.map((c) => c.keyword).filter((keyword) => keyword !== 'other'),
      });
      for (const c of node.cases) walk(c.body, params);
      return;
  }
}

/**
 * Stores a parameter's type, narrowing it against an earlier use; uses with no common type throw.
 */
function record(
  params: Record<string, MessageParamType>,
  name: string,
  type: MessageParamType,
): void {
  const existing = hasKey(params, name) ? params[name] : undefined;
  if (isUndefined(existing)) {
    params[name] = type;
    return;
  }

  const merged = narrow(existing, type);
  if (isNull(merged)) {
    throw new Error(
      `Message parameter \`${name}\` is used as both a ${existing.kind} and a ${type.kind}.`,
    );
  }
  params[name] = merged;
}

/**
 * Returns the type satisfying both uses, or `null` when none does; two choices merge their options.
 */
function narrow(a: MessageParamType, b: MessageParamType): MessageParamType | null {
  if (a.kind === 'choice' && b.kind === 'choice') {
    return { kind: 'choice', options: uniqueArray([...a.options, ...b.options]) };
  }
  if (a.kind === 'choice') return b.kind === 'value' ? a : null;
  if (b.kind === 'choice') return a.kind === 'value' ? b : null;
  if (a.kind === b.kind) return a;
  return { kind: 'number' };
}
