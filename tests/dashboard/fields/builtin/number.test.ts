import { deepStrictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import type { DashboardField } from '../../../../src/dashboard/runtime/meta-types.ts';

import { effectScope } from '../../../../src/utils/reactive/effect-scope.ts';
import { inputOf, type } from '../_controls.ts';

const { numberType } = await import('../../../../src/dashboard/fields/builtin/number.ts');

const GOLD: DashboardField = {
  name: 'gold',
  type: 'number',
  kind: 'column',
  label: 'Gold',
  nullable: false,
  required: true,
  unique: false,
  translatable: false,
  readable: true,
  writable: true,
  immutable: false,
  options: { min: 0, max: 1000 },
};

describe('numberType control', () => {
  it('checks a changed value against `min` and `max` with the server keys', () => {
    effectScope().run(() => {
      const control = numberType.control?.({
        field: GOLD,
        initial: 5000,
        mode: 'edit',
        path: 'gold',
        language: () => 'en',
        onInput() {},
      });
      deepStrictEqual(control?.read(), { value: 5000 });
      type(inputOf(control?.element), '-3');
      deepStrictEqual(control?.read(), { errors: { '': 'validation.minValue' } });
      type(inputOf(control?.element), '250.5');
      deepStrictEqual(control?.read(), { value: 250.5 });
      type(inputOf(control?.element), 'lots');
      deepStrictEqual(control?.read(), { errors: { '': 'dashboard.invalidNumber' } });
    });
  });
});
