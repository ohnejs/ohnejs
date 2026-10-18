import { deepStrictEqual, strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import type { DashboardField } from '../../../../src/dashboard/runtime/meta-types.ts';

import { flush } from '../../../../src/utils/reactive/_scheduler.ts';
import { effectScope } from '../../../../src/utils/reactive/effect-scope.ts';
import { fire } from '../../ui/_events.ts';
import { inputOf, type } from '../_controls.ts';

const { integerType } = await import('../../../../src/dashboard/fields/builtin/integer.ts');

const MINUTES: DashboardField = {
  name: 'minutes',
  type: 'integer',
  kind: 'column',
  label: 'Minutes',
  nullable: false,
  required: true,
  unique: false,
  translatable: false,
  readable: true,
  writable: true,
  immutable: false,
  options: { min: 1 },
};

function control(initial: unknown) {
  return integerType.control!({
    field: MINUTES,
    initial,
    mode: 'edit',
    path: 'minutes',
    language: () => 'en',
    onInput() {},
  })!;
}

describe('integerType control', () => {
  it('drafts the parsed integer, or the text as typed while it does not parse', () => {
    effectScope().run(() => {
      const minutes = control(12);
      type(inputOf(minutes.element), '1e3');
      strictEqual(minutes.draft?.(), 1000);
      type(inputOf(minutes.element), '0');
      strictEqual(minutes.draft?.(), 0);
      deepStrictEqual(minutes.read(), { errors: { '': 'validation.minValue' } });
      type(inputOf(minutes.element), '22ab');
      strictEqual(minutes.draft?.(), '22ab');
      deepStrictEqual(minutes.read(), { errors: { '': 'dashboard.invalidInteger' } });
    });
  });

  it('rebuilds from a drafted text and still refuses it', () => {
    effectScope().run(() => {
      const minutes = control('22ab');
      strictEqual((inputOf(minutes.element) as unknown as { value: string }).value, '22ab');
      strictEqual(minutes.draft?.(), '22ab');
      deepStrictEqual(minutes.read(), { errors: { '': 'dashboard.invalidInteger' } });
    });
  });

  it('drafts nothing for a pristine control over none', () => {
    effectScope().run(() => {
      strictEqual(control(undefined).draft?.(), undefined);
    });
  });

  it('restores a drafted text into its input and still refuses it, dirty against the stored value', () => {
    effectScope().run(() => {
      const minutes = control(12);
      const input = inputOf(minutes.element);
      minutes.restore?.('22ab');
      flush();
      strictEqual(inputOf(minutes.element), input);
      strictEqual((input as unknown as { value: string }).value, '22ab');
      strictEqual(minutes.draft?.(), '22ab');
      deepStrictEqual(minutes.read(), { errors: { '': 'dashboard.invalidInteger' } });
      strictEqual(minutes.dirty(), true);
      minutes.restore?.(0);
      deepStrictEqual(minutes.read(), { errors: { '': 'validation.minValue' } });
      minutes.restore?.(12);
      strictEqual(minutes.dirty(), false);
      deepStrictEqual(minutes.read(), { value: 12 });
    });
  });

  it('stops the arrow keys at `min` and `max`', () => {
    effectScope().run(() => {
      const minutes = control(2);
      const input = inputOf(minutes.element);
      const press = (key: string, shiftKey = false): void => {
        fire(input, 'keydown', { key, shiftKey });
      };
      press('ArrowDown');
      deepStrictEqual(minutes.read(), { value: 1 });
      press('ArrowDown');
      deepStrictEqual(minutes.read(), { value: 1 });
      press('ArrowDown', true);
      deepStrictEqual(minutes.read(), { value: 1 });
      const bounded = integerType.control!({
        field: { ...MINUTES, options: { min: 1, max: 4 } },
        initial: 3,
        mode: 'edit',
        path: 'minutes',
        language: () => 'en',
        onInput() {},
      })!;
      fire(inputOf(bounded.element), 'keydown', { key: 'ArrowUp', shiftKey: true });
      deepStrictEqual(bounded.read(), { value: 4 });
    });
  });

  it('asks for a digit pad only when `min` rules out negatives', () => {
    effectScope().run(() => {
      const mode = (options: DashboardField['options']): string | null =>
        inputOf(
          integerType.control!({
            field: { ...MINUTES, options },
            initial: 1,
            mode: 'edit',
            path: 'minutes',
            language: () => 'en',
            onInput() {},
          })!.element,
        ).getAttribute('inputmode');
      strictEqual(mode({ min: 0 }), 'numeric');
      strictEqual(mode({ min: -10 }), null);
      strictEqual(mode({}), null);
    });
  });
});
