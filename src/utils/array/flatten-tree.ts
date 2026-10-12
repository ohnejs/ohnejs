/**
 * Lists every node of a tree depth-first, each node before its `children`.
 *
 * @example
 * ```ts
 * flattenTree([{ id: 'a', children: [{ id: 'b' }] }, { id: 'c' }]).map((node) => node.id)
 * // -> ['a', 'b', 'c']
 * ```
 */
export function flattenTree<T extends { children?: readonly T[] }>(nodes: readonly T[]): T[] {
  return nodes.flatMap((node) => [node, ...flattenTree(node.children ?? [])]);
}
