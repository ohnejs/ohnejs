import { deepStrictEqual, strictEqual } from 'node:assert';
import { describe, it, mock } from 'node:test';

import type { DashboardCollection } from '../../../../src/dashboard/runtime/meta-types.ts';

import { seedLabel } from '../../../../src/dashboard/fields/labels.ts';
import '../_controls.ts';

const { recordChoiceSource } = await import('../../../../src/dashboard/fields/builtin/record.ts');

const target = {
  name: 'Destinations',
  segment: 'destinations',
  labelFields: ['name'],
} as unknown as DashboardCollection;

describe('recordChoiceSource', () => {
  it('answers a label the shared cache knows without a request', async () => {
    const fetch = mock.method(globalThis, 'fetch', () => {
      throw new Error('no request expected');
    });
    seedLabel('Destinations', 'd1', 'Icecrown Citadel');
    seedLabel('Destinations', 'd2', 'Dalaran');
    const source = recordChoiceSource(target);
    deepStrictEqual(await source.choiceOf('d1'), { value: 'd1', label: 'Icecrown Citadel' });
    deepStrictEqual(await source.choicesOf(['d2', 'd1']), [
      { value: 'd2', label: 'Dalaran' },
      { value: 'd1', label: 'Icecrown Citadel' },
    ]);
    strictEqual(fetch.mock.callCount(), 0);
    fetch.mock.restore();
  });
});
