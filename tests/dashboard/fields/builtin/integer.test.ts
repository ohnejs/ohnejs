import { deepStrictEqual, strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import type { DashboardField } from '../../../../src/dashboard/runtime/meta-types.ts';

import { flush } from '../../../../src/utils/reactive/_scheduler.ts';
import { effectScope } from '../../../../src/utils/reactive/effect-scope.ts';
import { type FakeElement, findElement, hasClass } from '../../_fake-dom.ts';
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

describe('integerType amounts', () => {
  const PRICE: DashboardField = {
    ...MINUTES,
    name: 'price',
    label: 'Price',
    options: { currency: 'EUR', min: 100 },
  };
  const nbsp = (text: string): string => text.replaceAll(' ', '\u00a0');
  const amount = (
    initial: unknown,
    language = 'de',
    options: DashboardField['options'] = PRICE.options,
  ) =>
    integerType.control!({
      field: { ...PRICE, options },
      initial,
      mode: 'edit',
      path: 'price',
      language: () => language,
      onInput() {},
    })!;
  const text = (root: unknown): string => (inputOf(root) as unknown as { value: string }).value;
  const affix = (root: unknown): FakeElement | undefined =>
    findElement(root as FakeElement, (element) => hasClass(element, 'ohne-numeric-affix'));

  it('edits minor units as an amount in the language, and reads them back exactly', () => {
    effectScope().run(() => {
      const price = amount(123450);
      flush();
      strictEqual(text(price.element), '1234,50');
      strictEqual(price.dirty(), false);
      type(inputOf(price.element), '12,3');
      deepStrictEqual(price.read(), { value: 1230 });
      type(inputOf(price.element), '12.345');
      deepStrictEqual(price.read(), { errors: { '': 'dashboard.invalidAmount' } });
    });
  });

  it('keeps ASCII digits for a language that writes its own', () => {
    effectScope().run(() => {
      const price = amount(123450, 'ar-EG');
      strictEqual(text(price.element), '1234.50');
      strictEqual(price.dirty(), false);
    });
  });

  it('reads an untouched negative amount clean in a language with its own minus', () => {
    effectScope().run(() => {
      const refund = amount(-1234, 'sv', { currency: 'EUR' });
      strictEqual(text(refund.element), '-12,34');
      strictEqual(refund.dirty(), false);
      deepStrictEqual(refund.read(), { value: -1234 });
    });
  });

  it('shows the symbol on the side the language writes it', () => {
    effectScope().run(() => {
      const german = amount(100, 'de');
      flush();
      strictEqual(hasClass(affix(german.element)!, 'ohne-numeric-suffix'), true);
      strictEqual(affix(german.element)?.textContent, '€');
      const english = amount(100, 'en');
      flush();
      strictEqual(hasClass(affix(english.element)!, 'ohne-numeric-prefix'), true);
    });
  });

  it('checks a changed bound as an amount', () => {
    effectScope().run(() => {
      const price = amount(500);
      type(inputOf(price.element), '0,5');
      deepStrictEqual(price.read(), { errors: { '': 'validation.minValue' } });
    });
  });

  it('steps one major unit on the arrow keys and writes the canonical text on blur', () => {
    effectScope().run(() => {
      const price = amount(1234, 'en', { currency: 'EUR' });
      const input = inputOf(price.element);
      fire(input, 'keydown', { key: 'ArrowUp' });
      flush();
      strictEqual(text(price.element), '13.34');
      type(input, '7,5');
      fire(input, 'blur');
      flush();
      strictEqual(text(price.element), '7.50');
      deepStrictEqual(price.read(), { value: 750 });
    });
  });

  it('shows the amount in the cell and the summary', () => {
    const cell = (
      integerType.display!({
        field: PRICE,
        value: () => 1234,
        language: () => 'de',
      } as never) as unknown as () => FakeElement
    )();
    strictEqual(cell.getAttribute('title'), nbsp('12,34 €'));
  });

  it('filters on the amount typed, written as minor units', () => {
    effectScope().run(() => {
      const written: unknown[] = [];
      const input = integerType.filter!.input({
        field: PRICE,
        operator: () => 'gte',
        value: () => 1234,
        set: (next: unknown) => written.push(next),
        commit() {},
        inputID: 'price',
        language: () => 'de',
      } as never);
      strictEqual(text(input), '12,34');
      type(inputOf(input), '19,9');
      deepStrictEqual(written, [1990]);
    });
  });
});
