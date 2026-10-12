import { deepStrictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { flattenTree } from '../../../src/utils/index.ts';

interface Node {
  id: string;
  children?: Node[];
}

const ids = (nodes: Node[]) => flattenTree(nodes).map((node) => node.id);

describe('flattenTree', () => {
  it('lists each node before its children, depth-first', () => {
    const tree = [
      { id: 'a', children: [{ id: 'b', children: [{ id: 'c' }] }, { id: 'd' }] },
      { id: 'e' },
    ];
    deepStrictEqual(ids(tree), ['a', 'b', 'c', 'd', 'e']);
  });

  it('returns an empty list for an empty tree', () => {
    deepStrictEqual(ids([]), []);
  });
});
