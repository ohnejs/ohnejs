import { deepStrictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { resolveLayoutNodes } from '../../../src/utils/field-layout/resolve-layout-nodes.ts';

const NAMES = new Set(['thrall', 'jaina', 'arthas']);

describe('resolveLayoutNodes', () => {
  it('splits widths and tags every node with its kind', () => {
    deepStrictEqual(
      resolveLayoutNodes(
        [
          { row: ['thrall | 60%', 'jaina'] },
          '---',
          { card: { label: 'Scourge', collapsible: true, fields: ['arthas | auto'] } },
        ],
        NAMES,
      ),
      [
        {
          kind: 'row',
          nodes: [
            { kind: 'field', name: 'thrall', width: '60%' },
            { kind: 'field', name: 'jaina' },
          ],
        },
        { kind: 'rule' },
        {
          kind: 'card',
          label: 'Scourge',
          collapsible: true,
          nodes: [{ kind: 'field', name: 'arthas', width: 'auto' }],
        },
      ],
    );
  });

  it('defaults a shorthand card to not collapsible and without a label', () => {
    deepStrictEqual(resolveLayoutNodes([{ card: ['thrall'] }], NAMES), [
      { kind: 'card', collapsible: false, nodes: [{ kind: 'field', name: 'thrall' }] },
    ]);
  });

  it('drops unknown names and every container they leave empty', () => {
    deepStrictEqual(
      resolveLayoutNodes(
        [
          { row: ['illidan'] },
          { card: ['illidan'] },
          {
            tabs: [
              { label: 'Outland', fields: ['illidan'] },
              { label: 'Horde', fields: ['thrall'] },
            ],
          },
        ],
        NAMES,
      ),
      [
        {
          kind: 'tabs',
          tabs: [{ label: 'Horde', nodes: [{ kind: 'field', name: 'thrall' }] }],
        },
      ],
    );
    deepStrictEqual(
      resolveLayoutNodes([{ tabs: [{ label: 'x', fields: ['illidan'] }] }], NAMES),
      [],
    );
  });

  it('passes labels through untouched, whatever their type', () => {
    const label = (): string => 'Horde';
    const [node] = resolveLayoutNodes([{ tabs: [{ label, fields: ['thrall'] }] }], NAMES);
    deepStrictEqual(node, {
      kind: 'tabs',
      tabs: [{ label, nodes: [{ kind: 'field', name: 'thrall' }] }],
    });
  });
});
