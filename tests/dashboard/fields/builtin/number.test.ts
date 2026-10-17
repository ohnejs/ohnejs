import { deepStrictEqual, strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import type { DashboardField } from '../../../../src/dashboard/runtime/meta-types.ts';

import { flush } from '../../../../src/utils/reactive/_scheduler.ts';
import { effectScope } from '../../../../src/utils/reactive/effect-scope.ts';
import { fire } from '../../ui/_events.ts';
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

  it('drafts the parsed number, or the text as typed while it does not parse', () => {
    effectScope().run(() => {
      const control = numberType.control?.({
        field: GOLD,
        initial: 5000,
        mode: 'edit',
        path: 'gold',
        language: () => 'en',
        onInput() {},
      });
      type(inputOf(control?.element), '250.5');
      strictEqual(control?.draft?.(), 250.5);
      type(inputOf(control?.element), '-3');
      strictEqual(control?.draft?.(), -3);
      type(inputOf(control?.element), 'lots');
      strictEqual(control?.draft?.(), 'lots');
    });
  });

  it('restores a drafted text into its input and still refuses it, dirty against the stored value', () => {
    effectScope().run(() => {
      const control = numberType.control!({
        field: GOLD,
        initial: 5000,
        mode: 'edit',
        path: 'gold',
        language: () => 'en',
        onInput() {},
      })!;
      control.restore?.('lots');
      flush();
      strictEqual((inputOf(control.element) as unknown as { value: string }).value, 'lots');
      deepStrictEqual(control.read(), { errors: { '': 'dashboard.invalidNumber' } });
      strictEqual(control.dirty(), true);
      control.restore?.(250.5);
      deepStrictEqual(control.read(), { value: 250.5 });
      control.restore?.(5000);
      strictEqual(control.dirty(), false);
    });
  });

  it('steps by 1 on the arrow keys and by 10 with Shift, kept to the decimals of the value', () => {
    effectScope().run(() => {
      let inputs = 0;
      const control = numberType.control!({
        field: { ...GOLD, options: {} },
        initial: 4.9,
        mode: 'edit',
        path: 'gold',
        language: () => 'en',
        onInput() {
          inputs++;
        },
      })!;
      const input = inputOf(control.element);
      const press = (key: string, shiftKey = false): boolean =>
        fire(input, 'keydown', { key, shiftKey }).defaultPrevented;
      strictEqual(press('ArrowUp'), true);
      deepStrictEqual(control.read(), { value: 5.9 });
      press('ArrowDown', true);
      deepStrictEqual(control.read(), { value: -4.1 });
      type(input, '0.1');
      press('ArrowUp');
      press('ArrowUp');
      deepStrictEqual(control.read(), { value: 2.1 });
      strictEqual(inputs, 5);
      type(input, 'lots');
      strictEqual(press('ArrowUp'), false);
      strictEqual(press('ArrowLeft'), false);
    });
  });

  it('stops the arrow keys at `min` and `max`, showing the bound itself', () => {
    effectScope().run(() => {
      const control = numberType.control!({
        field: { ...GOLD, options: { min: 0, max: 5 } },
        initial: 4.9,
        mode: 'edit',
        path: 'gold',
        language: () => 'en',
        onInput() {},
      })!;
      const input = inputOf(control.element);
      const press = (key: string, shiftKey = false): void => {
        fire(input, 'keydown', { key, shiftKey });
        flush();
      };
      press('ArrowUp');
      deepStrictEqual(control.read(), { value: 5 });
      strictEqual((input as unknown as { value: string }).value, '5');
      press('ArrowDown', true);
      deepStrictEqual(control.read(), { value: 0 });
      press('ArrowDown');
      deepStrictEqual(control.read(), { value: 0 });
      type(input, '4.25');
      press('ArrowUp');
      deepStrictEqual(control.read(), { value: 5 });
    });
  });
});
