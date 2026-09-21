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
 * Dots descend into an `object` composite, and each operator must apply to the field the path lands on.
 * A dot path through a repeater is rejected: it holds many items, and `has` is how a `when` walks them.
 * A `has` on a `record`/`records`/`blocks` may only be the bare `true` form.
 * The grammar itself was already checked when the node parsed, so only scope and applicability remain.
 * A violation throws `ohneError`, naming the field and its collection.
 */
export function validateWhen(meta: CollectionQueryMeta): void {
  walkScope(meta.fields, [meta.fields], `collection \`${meta.collection}\``, true);
}

/**
 * Validates every `when` a block declares against the block's own field graph.
 *
 * The same rules as `validateWhen`, except paths are block-scoped: bare sibling segments only.
 * `/` and `../` are rejected - a block cannot anchor into a host it does not know.
 */
export function validateBlockWhen(block: string, fields: Record<string, FieldQueryMeta>): void {
  walkScope(fields, [fields], `block \`${block}\``, false);
}

/**
 * Walks one scope, validating each field's `when`, then recursing into every composite subfield scope.
 * The ancestry runs root-first, so a `../` climb pops its tail and a `/` anchor reads its head.
 * `home` is the owning scope's rendered phrase; `anchors` admits `/` and `../` paths.
 */
function walkScope(scope: Scope, ancestry: readonly Scope[], home: string, anchors: boolean): void {
  for (const [name, field] of Object.entries(scope)) {
    if (!isUndefined(field.when)) {
      validateFieldWhen(name, field, field.when, ancestry, home, anchors);
    }
    if (field.kind === 'childOne' || field.kind === 'childMany') {
      walkScope(field.subfields as Scope, [...ancestry, field.subfields as Scope], home, anchors);
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
  home: string,
  anchors: boolean,
): void {
  if (!satisfiesInactive(field)) throw whenNeedsDefault(name, home);
  checkNode(when, name, ancestry, home, true, anchors);
}

/**
 * Whether a `when`-gated field can still land a value when it is inactive on a create.
 * A nullable field takes `null`; a list its empty `[]`; a defaulted field its default.
 */
function satisfiesInactive(field: FieldQueryMeta): boolean {
  if (field.nullable) return true;
  if (field.kind === 'records' || field.kind === 'childMany' || field.kind === 'blocks') {
    return true;
  }
  if (!isUndefined(field.options) && hasKey(field.options, 'default')) return true;
  return !isUndefined(field.fieldType?.defaultValue);
}

/**
 * Validates one condition node, recursing through groups and into a `has`'s nested condition.
 *
 * A leaf resolves its path, anchored against the ancestry at the top level, or by plain descent in a `has`.
 * That matches the runtime evaluator, which reads a nested `has` relative to the walked item alone.
 * The operator must apply to the field the path lands on.
 * A nested `has` over a relation or a blocks field is rejected: neither value can be walked in JS.
 */
function checkNode(
  node: ConditionNode,
  field: string,
  ancestry: readonly Scope[],
  home: string,
  anchored: boolean,
  anchors: boolean,
): void {
  if (node.kind === 'and' || node.kind === 'or') {
    for (const child of node.nodes) checkNode(child, field, ancestry, home, anchored, anchors);
    return;
  }
  if (!anchors && (node.path[0] === '/' || node.path[0] === '..')) {
    throw anchoredBlockPath(node.path, field, home);
  }
  const scope = ancestry[ancestry.length - 1];
  const resolved = anchored ? resolveAnchored(node.path, ancestry) : descend(node.path, scope);
  if (isUndefined(resolved)) throw unknownWhenPath(node.path, field, home);
  if ('repeater' in resolved)
    throw whenPathThroughRepeater(resolved.repeater, node.path, field, home);
  const target = resolved.field;
  const operator = node.kind === 'compare' ? node.op : node.kind;
  // `_translations` is probed from tables, so the written record a `when` reads never carries it.
  if (target.kind === 'translations' || !allowedOperators(target).has(operator)) {
    throw inapplicableWhenOp(operator, node.path, field, home);
  }
  if (node.kind === 'has' && !isNull(node.condition)) {
    if (target.kind === 'record' || target.kind === 'records' || target.kind === 'blocks') {
      throw nestedHasOnWalkless(target.kind, node.path, field, home);
    }
    checkNode(node.condition, field, [target.subfields as Scope], home, false, anchors);
  }
}

/**
 * A path resolution's outcome: the field it lands on, or the repeater segment a dot path cannot cross.
 * The runtime resolver descends plain objects, and a repeater's value is an array - a dead lookup.
 */
type Resolution = { field: FieldQueryMeta } | { repeater: string };

/**
 * Resolves an anchored path: `/` reads the root scope, each `..` climbs one level, then names descend.
 * A climb past the root, or a name outside the scope, resolves to nothing.
 */
function resolveAnchored(
  segments: readonly string[],
  ancestry: readonly Scope[],
): Resolution | undefined {
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
 * Descends a name path through a scope, stepping into an `object` composite's subfields at each segment.
 * A segment naming a non-composite before the last, or an absent field, resolves to nothing.
 * A repeater before the last segment stops the walk, naming itself.
 */
function descend(names: readonly string[], scope: Scope): Resolution | undefined {
  let field: FieldQueryMeta | undefined;
  let current: Scope | undefined = scope;
  for (const [index, name] of names.entries()) {
    if (isUndefined(current)) return undefined;
    field = current[name];
    if (isUndefined(field)) return undefined;
    if (field.kind === 'childMany' && index < names.length - 1) return { repeater: name };
    current = field.kind === 'childOne' || field.kind === 'childMany' ? field.subfields : undefined;
  }
  return isUndefined(field) ? undefined : { field };
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
function whenNeedsDefault(field: string, home: string): ReturnType<typeof ohneError> {
  return ohneError({
    title: `\`when\`-gated field \`${field}\` must be nullable or have a default`,
    body: [
      `Field \`${field}\` in ${home} is gated by \`when\` but is neither nullable nor defaulted.`,
      'An inactive create still writes a value, so make the field `nullable` or give it a `default`.',
    ],
  });
}

/**
 * The failure a block-owned `when` raises when a path anchors with `/` or `../`.
 */
function anchoredBlockPath(
  segments: readonly string[],
  field: string,
  home: string,
): ReturnType<typeof ohneError> {
  const path = whenPathText(segments);
  return ohneError({
    title: `\`when\` path \`${path}\` anchors outside the block`,
    body: [
      `The \`when\` on field \`${field}\` in ${home} anchors \`${path}\` with \`/\` or \`../\`.`,
      'A block resolves `when` paths in its own scope alone - use bare sibling names.',
    ],
  });
}

/**
 * The failure a `when` raises when a dot path descends through a repeater, which holds many items.
 */
function whenPathThroughRepeater(
  segment: string,
  segments: readonly string[],
  field: string,
  home: string,
): ReturnType<typeof ohneError> {
  const path = whenPathText(segments);
  return ohneError({
    title: `\`when\` path \`${path}\` descends through the repeater \`${segment}\``,
    body: [
      `The \`when\` on field \`${field}\` in ${home} walks \`${path}\` through \`${segment}\`, which holds many items.`,
      'A dot path cannot pick one item - use `has` on the repeater to match its items.',
    ],
  });
}

/**
 * The failure a `when` raises when a path addresses no field, including a `../` that climbs past the root.
 */
function unknownWhenPath(
  segments: readonly string[],
  field: string,
  home: string,
): ReturnType<typeof ohneError> {
  const path = whenPathText(segments);
  return ohneError({
    title: `Unknown \`when\` path \`${path}\` on \`${field}\``,
    body: [
      `The \`when\` on field \`${field}\` in ${home} addresses \`${path}\`, which resolves to no field.`,
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
  home: string,
): ReturnType<typeof ohneError> {
  const path = whenPathText(segments);
  return ohneError({
    title: `Operator \`${operator}\` does not apply in the \`when\` on \`${field}\``,
    body: [
      `The \`when\` on field \`${field}\` in ${home} uses \`${operator}\` on \`${path}\`, which does not support it.`,
    ],
  });
}

/**
 * The failure a `when` raises when a `has` walks into a relation or a blocks field with a nested condition.
 */
function nestedHasOnWalkless(
  kind: FieldQueryMeta['kind'],
  segments: readonly string[],
  field: string,
  home: string,
): ReturnType<typeof ohneError> {
  const path = whenPathText(segments);
  const reason =
    kind === 'blocks'
      ? 'A blocks value is a discriminated list and cannot be walked in a `when`, so use `has: true`.'
      : 'A `record`/`records` is a `UUID` at write time and cannot be walked, so use `has: true`.';
  return ohneError({
    title: `\`has\` on \`${path}\` must be bare \`true\` in a \`when\``,
    body: [
      `The \`when\` on field \`${field}\` in ${home} walks \`${path}\` with a nested condition.`,
      reason,
    ],
  });
}
