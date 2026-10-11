import { deepStrictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { layoutFieldNames } from '../../../src/utils/field-layout/layout-field-names.ts';

describe('layoutFieldNames', () => {
  it('walks rows, cards, and tabs in reading order, skipping rules', () => {
    deepStrictEqual(
      layoutFieldNames([
        { row: ['a', 'b | 8rem'] },
        '---',
        { card: ['c', { card: { fields: ['d'] } }] },
        {
          tabs: [
            { label: 'x', fields: ['e'] },
            { label: 'y', fields: [{ row: ['f'] }] },
          ],
        },
        'g',
      ]),
      ['a', 'b', 'c', 'd', 'e', 'f', 'g'],
    );
  });

  it('accepts labels of any type', () => {
    deepStrictEqual(layoutFieldNames([{ tabs: [{ label: () => 'Horde', fields: ['thrall'] }] }]), [
      'thrall',
    ]);
  });
});
