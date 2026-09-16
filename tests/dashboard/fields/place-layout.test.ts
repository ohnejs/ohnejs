import { deepStrictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import type { DashboardLayoutNode } from '../../../src/dashboard/runtime/meta-types.ts';

import { placeLayout } from '../../../src/dashboard/fields/place-layout.ts';

const field = (name: string, width?: string): DashboardLayoutNode =>
  width === undefined ? { kind: 'field', name } : { kind: 'field', name, width };

describe('placeLayout', () => {
  it('keeps every node the form renders and appends the rest in order', () => {
    const layout: DashboardLayoutNode[] = [
      { kind: 'row', nodes: [field('a', '8rem'), field('b')] },
      { kind: 'rule' },
      { kind: 'card', collapsible: false, nodes: [field('c')] },
    ];
    deepStrictEqual(placeLayout(layout, ['e', 'a', 'b', 'c', 'd']), {
      nodes: layout,
      rest: ['e', 'd'],
    });
  });

  it('drops unrendered names and the containers they empty, tabs included', () => {
    const layout: DashboardLayoutNode[] = [
      { kind: 'row', nodes: [field('a'), field('gone')] },
      {
        kind: 'card',
        collapsible: true,
        label: 'x',
        nodes: [{ kind: 'row', nodes: [field('gone')] }],
      },
      {
        kind: 'tabs',
        tabs: [
          { label: 'one', nodes: [field('gone')] },
          { label: 'two', nodes: [field('b')] },
        ],
      },
    ];
    deepStrictEqual(placeLayout(layout, ['a', 'b']), {
      nodes: [
        { kind: 'row', nodes: [field('a')] },
        { kind: 'tabs', tabs: [{ label: 'two', nodes: [field('b')] }] },
      ],
      rest: [],
    });
  });

  it('never leads, trails, or doubles a rule once neighbours drop', () => {
    const layout: DashboardLayoutNode[] = [
      { kind: 'rule' },
      field('gone'),
      { kind: 'rule' },
      field('a'),
      { kind: 'rule' },
      { kind: 'rule' },
      field('b'),
      { kind: 'rule' },
      field('gone'),
    ];
    deepStrictEqual(placeLayout(layout, ['a', 'b']).nodes, [
      field('a'),
      { kind: 'rule' },
      field('b'),
    ]);
  });

  it('places nothing over an empty form', () => {
    deepStrictEqual(placeLayout([field('a')], []), { nodes: [], rest: [] });
  });
});
