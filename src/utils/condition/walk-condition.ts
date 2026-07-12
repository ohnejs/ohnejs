import type { ConditionNode } from './operators.ts';

import { isNull } from '../is/is-null.ts';

/**
 * Position of a node during a `walkCondition` traversal.
 */
export interface WalkConditionInfo {
  /**
   * Nesting depth from the root, which sits at `0`.
   * Descending into `and`/`or` children or a `has` node's nested condition adds one level.
   */
  depth: number;

  /**
   * How many `has` boundaries enclose the node.
   */
  hasDepth: number;
}

function step(
  node: ConditionNode,
  visit: (node: ConditionNode, info: WalkConditionInfo) => void,
  depth: number,
  hasDepth: number,
): void {
  visit(node, { depth, hasDepth });
  if (node.kind === 'and' || node.kind === 'or') {
    for (const child of node.nodes) step(child, visit, depth + 1, hasDepth);
  } else if (node.kind === 'has' && !isNull(node.condition)) {
    step(node.condition, visit, depth + 1, hasDepth + 1);
  }
}

/**
 * Walks a condition AST pre-order, visiting every node once.
 * The root arrives at `depth` 0; group children and nested `has` conditions descend one level.
 * Entering a `has` node's condition also increments `hasDepth`.
 * The substrate for wire limiters counting nodes, depth, and `has` nesting.
 *
 * @example
 * ```ts
 * const kinds: string[] = []
 * walkCondition(node, (child, { depth }) => kinds.push(`${child.kind}@${depth}`))
 * kinds // -> ['and@0', 'compare@1', 'or@1', 'compare@2', 'compare@2']
 * ```
 */
export function walkCondition(
  node: ConditionNode,
  visit: (node: ConditionNode, info: WalkConditionInfo) => void,
): void {
  step(node, visit, 0, 0);
}
