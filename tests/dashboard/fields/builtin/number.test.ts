import { deepStrictEqual, strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import type { DashboardField } from '../../../../src/dashboard/runtime/meta-types.ts';

import { flush } from '../../../../src/utils/reactive/_scheduler.ts';
import { effectScope } from '../../../../src/utils/reactive/effect-scope.ts';
import { type FakeElement, findElement, hasClass } from '../../_fake-dom.ts';
import { fire } from '../../ui/_events.ts';
import { inputOf, type } from '../_controls.ts';

/**
 * The first `input` under `root` whose `type` is `kind`.
 */
const byType = (root: unknown, kind: string) =>
  findElement(
    root as FakeElement,
    (element) => element.tagName === 'INPUT' && (element.getAttribute('type') ?? 'text') === kind,
  ) as FakeElement;

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

  it('asks for a digit pad only when `min` rules out negatives', () => {
    effectScope().run(() => {
      const mode = (options: DashboardField['options']): string | null =>
        inputOf(
          numberType.control!({
            field: { ...GOLD, options },
            initial: 1,
            mode: 'edit',
            path: 'gold',
            language: () => 'en',
            onInput() {},
          })!.element,
        ).getAttribute('inputmode');
      strictEqual(mode({ min: 0 }), 'decimal');
      strictEqual(mode({ min: -10 }), null);
      strictEqual(mode({}), null);
    });
  });

  it('steps along the `step` grid and stops on its last point within bounds', () => {
    effectScope().run(() => {
      const control = numberType.control!({
        field: { ...GOLD, options: { min: 0, max: 1, step: 0.3 } },
        initial: 0.1,
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
      deepStrictEqual(control.read(), { value: 0.3 });
      press('ArrowUp', true);
      deepStrictEqual(control.read(), { value: 0.9 });
      press('ArrowDown');
      deepStrictEqual(control.read(), { value: 0.6 });
    });
  });

  it('checks a changed value against the grid, and leaves a stored one alone', () => {
    effectScope().run(() => {
      const control = numberType.control!({
        field: { ...GOLD, options: { step: 0.25 } },
        initial: 0.1,
        mode: 'edit',
        path: 'gold',
        language: () => 'en',
        onInput() {},
      })!;
      deepStrictEqual(control.read(), { value: 0.1 });
      type(inputOf(control.element), '0.3');
      deepStrictEqual(control.read(), { errors: { '': 'validation.invalidStep' } });
      type(inputOf(control.element), '0.75');
      deepStrictEqual(control.read(), { value: 0.75 });
    });
  });

  it('shows the suffix inside the input', () => {
    effectScope().run(() => {
      const control = numberType.control!({
        field: { ...GOLD, options: { suffix: 'kg' } },
        initial: 2,
        mode: 'edit',
        path: 'gold',
        language: () => 'en',
        onInput() {},
      })!;
      flush();
      const unit = findElement(control.element as unknown as FakeElement, (element) =>
        hasClass(element, 'ohne-numeric-suffix'),
      );
      strictEqual(unit?.textContent, 'kg');
    });
  });

  it('pairs a slider with the input under `display: slider`, both on one value', () => {
    effectScope().run(() => {
      const control = numberType.control!({
        field: { ...GOLD, options: { min: 0, max: 5, step: 0.5, display: 'slider' } },
        initial: 2,
        mode: 'edit',
        path: 'gold',
        language: () => 'en',
        onInput() {},
      })!;
      flush();
      const range = byType(control.element, 'range');
      const text = byType(control.element, 'text');
      strictEqual(range.getAttribute('aria-hidden'), 'true');
      strictEqual((range as unknown as { value: string }).value, '2');
      (range as unknown as { value: string }).value = '3.5';
      fire(range, 'input');
      flush();
      strictEqual((text as unknown as { value: string }).value, '3.5');
      deepStrictEqual(control.read(), { value: 3.5 });
      type(text, '1');
      flush();
      strictEqual((range as unknown as { value: string }).value, '1');
    });
  });

  it('marks the slider thumb while the value fails', () => {
    effectScope().run(() => {
      const control = numberType.control!({
        field: { ...GOLD, options: { min: 0, max: 5, display: 'slider' } },
        initial: undefined,
        mode: 'create',
        path: 'gold',
        language: () => 'en',
        onInput() {},
      })!;
      const range = byType(control.element, 'range');
      control.setErrors({ '': 'This field is required' });
      flush();
      strictEqual(range.getAttribute('aria-invalid'), 'true');
      type(byType(control.element, 'text'), '3');
      flush();
      strictEqual(range.getAttribute('aria-invalid'), null);
    });
  });

  it('renders the input alone when a slider has no range', () => {
    effectScope().run(() => {
      const control = numberType.control!({
        field: { ...GOLD, options: { display: 'slider' } },
        initial: 2,
        mode: 'edit',
        path: 'gold',
        language: () => 'en',
        onInput() {},
      })!;
      strictEqual(byType(control.element, 'range'), undefined);
    });
  });
});

describe('numberType display', () => {
  const cell = (value: unknown, options: DashboardField['options'] = {}) =>
    (
      numberType.display!({
        field: { ...GOLD, options },
        value: () => value,
        language: () => 'en',
      } as never) as unknown as () => FakeElement | string
    )() as FakeElement;

  it('shows the suffix dim beside the value, and both in the title', () => {
    const shown = cell(2.5, { suffix: 'kg' });
    strictEqual(shown.getAttribute('title'), '2.5 kg');
    strictEqual(shown.textContent, '2.5kg');
  });

  it('shows the value alone without a suffix', () => {
    strictEqual(cell(2.5).getAttribute('title'), '2.5');
  });

  it('summarizes with the unit', () => {
    strictEqual(numberType.summary!(2.5, { ...GOLD, options: { suffix: 'kg' } }), '2.5 kg');
    strictEqual(numberType.summary!(null, GOLD), '');
  });
});
