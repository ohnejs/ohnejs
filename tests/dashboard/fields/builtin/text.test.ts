import { deepStrictEqual, strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import type { DashboardField } from '../../../../src/dashboard/runtime/meta-types.ts';

import { flush } from '../../../../src/utils/reactive/_scheduler.ts';
import { effectScope } from '../../../../src/utils/reactive/effect-scope.ts';
import { type FakeElement, findElement } from '../../_fake-dom.ts';
import { inputOf, type } from '../_controls.ts';

const { textType } = await import('../../../../src/dashboard/fields/builtin/text.ts');

const field = (options: Record<string, unknown> = {}, nullable = false): DashboardField => ({
  name: 'headline',
  type: 'text',
  kind: 'column',
  logicalType: 'text',
  label: 'Headline',
  nullable,
  required: !nullable,
  unique: false,
  translatable: false,
  readable: true,
  writable: true,
  immutable: false,
  options,
});

function control(initial: unknown, options: Record<string, unknown> = {}, nullable = false) {
  return textType.control!({
    field: field(options, nullable),
    initial,
    mode: 'edit',
    path: 'headline',
    language: () => 'en',
    onInput() {},
  })!;
}

const valueOf = (root: unknown): string => (inputOf(root) as unknown as { value: string }).value;

describe('textType control', () => {
  it('restores text into its input, dirty against the stored value, so its check runs on read', () => {
    effectScope().run(() => {
      const headline = control('Ony', { max: 4 });
      const input = inputOf(headline.element);
      type(input, 'Naxx');
      headline.restore?.('Naxxramas');
      flush();
      strictEqual(inputOf(headline.element), input);
      strictEqual(valueOf(headline.element), 'Naxxramas');
      strictEqual(headline.dirty(), true);
      deepStrictEqual(headline.read(), { errors: { '': 'validation.maxLength' } });
      headline.restore?.('Ony');
      strictEqual(headline.dirty(), false);
      deepStrictEqual(headline.read(), { value: 'Ony' });
    });
  });

  it('restores none to pristine over none, and `null` to an emptied nullable field', () => {
    effectScope().run(() => {
      const fresh = control(undefined);
      type(inputOf(fresh.element), 'Wrath');
      fresh.restore?.(undefined);
      flush();
      strictEqual(valueOf(fresh.element), '');
      deepStrictEqual(fresh.read(), {});
      strictEqual(fresh.dirty(), false);
      const stored = control('Wrath', {}, true);
      stored.restore?.(null);
      flush();
      strictEqual(valueOf(stored.element), '');
      deepStrictEqual(stored.read(), { value: null });
      strictEqual(stored.dirty(), true);
    });
  });

  it('upgrades to a textarea for a restored newline', () => {
    effectScope().run(() => {
      const headline = control('Wrath');
      headline.restore?.('Wrath\nof the Lich King');
      flush();
      const area = findElement(
        headline.element as unknown as FakeElement,
        (element) => element.tagName === 'TEXTAREA',
      ) as (FakeElement & { value: string }) | undefined;
      strictEqual(area?.value, 'Wrath\nof the Lich King');
      deepStrictEqual(headline.read(), { value: 'Wrath\nof the Lich King' });
    });
  });
});
