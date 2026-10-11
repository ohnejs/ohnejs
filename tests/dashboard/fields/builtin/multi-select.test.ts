import { deepStrictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import type { DashboardField } from '../../../../src/dashboard/runtime/meta-types.ts';

import { effectScope } from '../../../../src/utils/reactive/effect-scope.ts';
import '../_controls.ts';

const { multiSelectType } =
  await import('../../../../src/dashboard/fields/builtin/multi-select.ts');

const ROLES: DashboardField = {
  name: 'roles',
  type: 'multiSelect',
  kind: 'column',
  label: 'Roles',
  nullable: false,
  required: false,
  unique: false,
  translatable: false,
  readable: true,
  writable: true,
  immutable: false,
  options: { choices: ['tank', 'healer'], max: 1 },
};

describe('multiSelectType control', () => {
  it('reads an untouched stored list as it is, unchecked', () => {
    effectScope().run(() => {
      const control = multiSelectType.control?.({
        field: ROLES,
        initial: ['tank', 'healer', 'bard'],
        mode: 'edit',
        path: 'roles',
        language: () => 'en',
        onInput() {},
      });
      deepStrictEqual(control?.read(), { value: ['tank', 'healer', 'bard'] });
    });
  });
});
