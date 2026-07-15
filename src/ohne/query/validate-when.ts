import type { ConditionNode } from '../../utils/index.ts';
import type { CollectionQueryMeta, FieldQueryMeta } from './metadata.ts';

import { hasKey, isNull, isUndefined } from '../../utils/index.ts';
import { ohneError } from '../error/ohne-error.ts';
import { allowedOperators } from './operators.ts';

/**
 * One scope's fields, keyed by name: a collection's fields, or a composite's subfields.
 */
type Scope = Record<string, FieldQueryMeta>;

/**
 * Validates every `when` a collection declares against its own field graph.
 *
 * A gated field must be nullable or defaulted, since an inactive create still writes a value.
 * A path resolves in scope: bare in the field's scope, `/` at the root, `../` one composite level up.
 * Dots descend into a composite, and each operator must apply to the field the path lands on.
 * A `has` on a `record`/`records` may only be the bare `true` form; a `UUID` cannot be walked in JS.
 * The grammar itself was already checked when the node parsed, so only scope and applicability remain.
 * A violation throws `ohneError`, naming the field and its collection.
 */
export function validateWhen(meta: CollectionQueryMeta): void {
  walkScope(meta.fields, [meta.fields], meta.collection);
}

/**
 * Walks one scope, validating each field's `when`, then recursing into every composite subfield scope.
 * The ancestry runs root-first, so a `../` climb pops its tail and a `/` anchor reads its head.
 */
function walkScope(scope: Scope, ancestry: readonly Scope[], collection: string): void {
  for (const [name, field] of Object.entries(scope)) {
    if (!isUndefined(field.when)) validateFieldWhen(name, field, field.when, ancestry, collection);
    if (field.kind === 'childOne' || field.kind === 'childMany') {
      walkScope(field.subfields as Scope, [...ancestry, field.subfields as Scope], collection);
    }
  }
}

/**
 * Validates one field's `when`: the nullable-or-default gate, then every leaf's path and operator.
 */
function validateFieldWhen(
  name: string,
  field: FieldQueryMeta,
  when: ConditionNode,
  ancestry: readonly Scope[],
  collection: string,
): void {
  if (!satisfiesInactive(field)) throw whenNeedsDefault(name, collection);
  checkNode(when, name, ancestry, collection, true);
}

/**
 * Whether a `when`-gated field can still land a value when it is inactive on a create.
 * A nullable field takes `null`; a list its empty `[]`; a defaulted field its default.
 */
function satisfiesInactive(field: FieldQueryMeta): boolean {
  if (field.nullable) return true;
  if (field.kind === 'records' || field.kind === 'childMany') return true;
  if (!isUndefined(field.options) && hasKey(field.options, 'default')) return true;
  return !isUndefined(field.fieldType?.defaultValue);
}

/**
 * Validates one condition node, recursing through groups and into a `has`'s nested condition.
 *
 * A leaf resolves its path, anchored against the ancestry at the top level, or by plain descent in a `has`.
 * That matches the runtime evaluator, which reads a nested `has` relative to the walked item alone.
 * The operator must apply to the field the path lands on; a nested `has` over a relation is rejected.
 */
function checkNode(
  node: ConditionNode,
  field: string,
  ancestry: readonly Scope[],
  collection: string,
  anchored: boolean,
): void {
  if (node.kind === 'and' || node.kind === 'or') {
    for (const child of node.nodes) checkNode(child, field, ancestry, collection, anchored);
    return;
  }
  const scope = ancestry[ancestry.length - 1];
  const resolved = anchored ? resolveAnchored(node.path, ancestry) : descend(node.path, scope);
  if (isUndefined(resolved)) throw unknownWhenPath(node.path, field, collection);
  const operator = node.kind === 'compare' ? node.op : node.kind;
  if (!allowedOperators(resolved).has(operator)) {
    throw inapplicableWhenOp(operator, node.path, field, collection);
  }
  if (node.kind === 'has' && !isNull(node.condition)) {
    if (resolved.kind === 'record' || resolved.kind === 'records') {
      throw nestedHasOnRelation(node.path, field, collection);
    }
    checkNode(node.condition, field, [resolved.subfields as Scope], collection, false);
  }
}

/**
 * Resolves an anchored path: `/` reads the root scope, each `..` climbs one level, then names descend.
 * A climb past the root, or a name outside the scope, resolves to nothing.
 */
function resolveAnchored(
  segments: readonly string[],
  ancestry: readonly Scope[],
): FieldQueryMeta | undefined {
  let index = ancestry.length - 1;
  let cursor = 0;
  if (segments[cursor] === '/') {
    index = 0;
    cursor += 1;
  }
  while (segments[cursor] === '..') {
    index -= 1;
    cursor += 1;
  }
  if (index < 0) return undefined;
  return descend(segments.slice(cursor), ancestry[index]);
}

/**
 * Descends a name path through a scope, stepping into a composite's subfields at each segment.
 * A segment naming a non-composite before the last, or an absent field, resolves to nothing.
 */
function descend(names: readonly string[], scope: Scope): FieldQueryMeta | undefined {
  let field: FieldQueryMeta | undefined;
  let current: Scope | undefined = scope;
  for (const name of names) {
    if (isUndefined(current)) return undefined;
    field = current[name];
    if (isUndefined(field)) return undefined;
    current = field.kind === 'childOne' || field.kind === 'childMany' ? field.subfields : undefined;
  }
  return field;
}

/**
 * Renders a path's segments back into its authored form, so an error reads the path the author wrote.
 */
function whenPathText(segments: readonly string[]): string {
  let out = '';
  let cursor = 0;
  if (segments[cursor] === '/') {
    out += '/';
    cursor += 1;
  }
  while (segments[cursor] === '..') {
    out += '../';
    cursor += 1;
  }
  return out + segments.slice(cursor).join('.');
}

/**
 * The failure a `when`-gated field raises when it can neither hold `null` nor fall back to a default.
 */
function whenNeedsDefault(field: string, collection: string): ReturnType<typeof ohneError> {
  return ohneError({
    title: `\`when\`-gated field \`${field}\` must be nullable or have a default`,
    body: [
      `Field \`${field}\` in collection \`${collection}\` is gated by \`when\` but is neither nullable nor defaulted.`,
      'An inactive create still writes a value, so make the field `nullable` or give it a `default`.',
    ],
  });
}

/**
 * The failure a `when` raises when a path addresses no field, including a `../` that climbs past the root.
 */
function unknownWhenPath(
  segments: readonly string[],
  field: string,
  collection: string,
): ReturnType<typeof ohneError> {
  const path = whenPathText(segments);
  return ohneError({
    title: `Unknown \`when\` path \`${path}\` on \`${field}\``,
    body: [
      `The \`when\` on field \`${field}\` in collection \`${collection}\` addresses \`${path}\`, which resolves to no field.`,
      'Check the path, and that no `../` climbs past the record root.',
    ],
  });
}

/**
 * The failure a `when` raises when it uses an operator the resolved field does not support.
 */
function inapplicableWhenOp(
  operator: string,
  segments: readonly string[],
  field: string,
  collection: string,
): ReturnType<typeof ohneError> {
  const path = whenPathText(segments);
  return ohneError({
    title: `Operator \`${operator}\` does not apply in the \`when\` on \`${field}\``,
    body: [
      `The \`when\` on field \`${field}\` in collection \`${collection}\` uses \`${operator}\` on \`${path}\`, which does not support it.`,
    ],
  });
}

/**
 * The failure a `when` raises when a `has` walks into a relation with a nested condition.
 */
function nestedHasOnRelation(
  segments: readonly string[],
  field: string,
  collection: string,
): ReturnType<typeof ohneError> {
  const path = whenPathText(segments);
  return ohneError({
    title: `\`has\` on relation \`${path}\` must be bare \`true\` in a \`when\``,
    body: [
      `The \`when\` on field \`${field}\` in collection \`${collection}\` walks \`${path}\` with a nested condition.`,
      'A `record`/`records` is a `UUID` at write time and cannot be walked, so use `has: true`.',
    ],
  });
}
