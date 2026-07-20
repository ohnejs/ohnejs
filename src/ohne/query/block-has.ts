import type { ConditionNode } from '../../utils/index.ts';

import { isString } from '../../utils/index.ts';

/**
 * A blocks discriminator leaf: a bare, un-negated `block` equality naming a type.
 */
type Discriminator = Extract<ConditionNode, { kind: 'compare' }> & { value: string };

/**
 * Whether a node is the discriminator shape a blocks `has` scope opens with.
 */
function isDiscriminator(node: ConditionNode): node is Discriminator {
  return (
    node.kind === 'compare' &&
    !node.negated &&
    node.op === 'equalsTo' &&
    node.path.length === 1 &&
    node.path[0] === 'block' &&
    isString(node.value)
  );
}

/**
 * Splits a blocks `has` condition into its discriminator and the remaining condition.
 *
 * The discriminator is exactly one top-level, bare, un-negated `block` equality naming the type.
 * It is the root node itself, or a direct child of a root `and`.
 * `rest` is what remains.
 * It is `null` when the discriminator stood alone, one sibling bare, or several re-wrapped as `and`.
 * Returns `{ ok: false }` when nothing matches - a `has` scope that names no type.
 *
 * A `block` leaf surviving into `rest` (negated, listed, grouped, a second equality) is deliberate.
 * The per-type scope has no `block` field, so it falls out there as an unknown field.
 */
export function splitBlockHas(
  condition: ConditionNode,
): { ok: true; block: string; rest: ConditionNode | null } | { ok: false } {
  if (isDiscriminator(condition)) return { ok: true, block: condition.value, rest: null };
  if (condition.kind !== 'and') return { ok: false };
  const index = condition.nodes.findIndex(isDiscriminator);
  if (index === -1) return { ok: false };
  const block = (condition.nodes[index] as Discriminator).value;
  const rest = condition.nodes.filter((_, position) => position !== index);
  if (rest.length === 0) return { ok: true, block, rest: null };
  if (rest.length === 1) return { ok: true, block, rest: rest[0] as ConditionNode };
  return { ok: true, block, rest: { kind: 'and', nodes: rest } };
}
