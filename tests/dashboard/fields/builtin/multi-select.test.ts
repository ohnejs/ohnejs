import { deepStrictEqual, strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import type { DashboardField } from '../../../../src/dashboard/runtime/meta-types.ts';

import { flush } from '../../../../src/utils/reactive/_scheduler.ts';
import { effectScope } from '../../../../src/utils/reactive/effect-scope.ts';
import { type FakeElement, findElement, hasClass } from '../../_fake-dom.ts';
import { fire } from '../../ui/_events.ts';
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

  it('drafts a changed list below `min`, which `read` refuses', () => {
    effectScope().run(() => {
      const control = multiSelectType.control?.({
        field: { ...ROLES, options: { choices: ['tank', 'healer'], min: 2 } },
        initial: ['tank', 'healer'],
        mode: 'edit',
        path: 'roles',
        language: () => 'en',
        onInput() {},
      });
      const remove = findElement(control?.element as unknown as FakeElement, (element) =>
        hasClass(element, 'ohne-chips-remove'),
      ) as FakeElement;
      fire(remove, 'click');
      flush();
      deepStrictEqual(control?.draft?.(), ['healer']);
      deepStrictEqual(control?.read(), { errors: { '': 'validation.minItems' } });
      const fresh = multiSelectType.control?.({
        field: ROLES,
        initial: undefined,
        mode: 'create',
        path: 'roles',
        language: () => 'en',
        onInput() {},
      });
      strictEqual(fresh?.draft?.(), undefined);
    });
  });

  it('restores a list in place, dirty against the stored one, and lands a chip change at once', () => {
    effectScope().run(() => {
      const seen: (boolean | undefined)[] = [];
      const control = multiSelectType.control!({
        field: { ...ROLES, options: { choices: ['tank', 'healer'] } },
        initial: ['tank'],
        mode: 'edit',
        path: 'roles',
        language: () => 'en',
        onInput: (discrete) => seen.push(discrete),
      })!;
      const list = findElement(control.element as unknown as FakeElement, (element) =>
        hasClass(element, 'ohne-chips-list'),
      );
      control.restore?.(['healer', 'tank']);
      flush();
      deepStrictEqual(seen, []);
      deepStrictEqual(control.read(), { value: ['healer', 'tank'] });
      strictEqual(control.dirty(), true);
      strictEqual(
        findElement(control.element as unknown as FakeElement, (element) =>
          hasClass(element, 'ohne-chips-list'),
        ),
        list,
      );
      control.restore?.(['tank']);
      strictEqual(control.dirty(), false);
      const remove = findElement(control.element as unknown as FakeElement, (element) =>
        hasClass(element, 'ohne-chips-remove'),
      ) as FakeElement;
      fire(remove, 'click');
      flush();
      deepStrictEqual(seen, [true]);
      deepStrictEqual(control.read(), { value: [] });
    });
  });
});
