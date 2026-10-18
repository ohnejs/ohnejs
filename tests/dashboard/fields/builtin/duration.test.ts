import { deepStrictEqual, strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import type { DashboardField } from '../../../../src/dashboard/runtime/meta-types.ts';

import { flush } from '../../../../src/utils/reactive/_scheduler.ts';
import { effectScope } from '../../../../src/utils/reactive/effect-scope.ts';
import { ref } from '../../../../src/utils/reactive/ref.ts';
import { type FakeElement, findElement, hasClass } from '../../_fake-dom.ts';
import { fire } from '../../ui/_events.ts';
import { inputOf, type } from '../_controls.ts';

const { durationType } = await import('../../../../src/dashboard/fields/builtin/duration.ts');

const COOLDOWN: DashboardField = {
  name: 'cooldown',
  type: 'duration',
  kind: 'column',
  label: 'Cooldown',
  nullable: false,
  required: true,
  unique: false,
  translatable: false,
  readable: true,
  writable: true,
  immutable: false,
  options: { min: 0, max: '1h' },
};

const control = (initial: unknown) =>
  durationType.control!({
    field: COOLDOWN,
    initial,
    mode: 'edit',
    path: 'cooldown',
    language: () => 'en',
    onInput() {},
  })!;

const text = (root: unknown): string => (inputOf(root) as unknown as { value: string }).value;
const previewOf = (root: unknown) =>
  findElement(root as FakeElement, (element) => hasClass(element, 'ohne-duration-preview'));

describe('durationType control', () => {
  it('shows the stored value as text and reads typed text as milliseconds', () => {
    effectScope().run(() => {
      const cooldown = control(1_800_000);
      strictEqual(text(cooldown.element), '30m');
      strictEqual(cooldown.dirty(), false);
      type(inputOf(cooldown.element), '45m');
      deepStrictEqual(cooldown.read(), { value: 2_700_000 });
      type(inputOf(cooldown.element), '0');
      deepStrictEqual(cooldown.read(), { value: 0 });
    });
  });

  it('refuses a bare number, and a duration past `max`', () => {
    effectScope().run(() => {
      const cooldown = control(1_800_000);
      type(inputOf(cooldown.element), '90');
      deepStrictEqual(cooldown.read(), { errors: { '': 'dashboard.invalidDuration' } });
      type(inputOf(cooldown.element), '2h');
      deepStrictEqual(cooldown.read(), { errors: { '': 'validation.maxValue' } });
    });
  });

  it('previews the duration in words, and writes canonical text on blur', () => {
    effectScope().run(() => {
      const cooldown = control(1_800_000);
      type(inputOf(cooldown.element), '90m');
      flush();
      strictEqual(previewOf(cooldown.element)?.textContent, '1 hour, 30 minutes');
      fire(inputOf(cooldown.element), 'blur');
      flush();
      strictEqual(text(cooldown.element), '1h 30m');
      strictEqual(cooldown.dirty(), true);
    });
  });

  it('renders a stored negative without throwing', () => {
    effectScope().run(() => {
      strictEqual(text(control(-1).element), '-1');
    });
  });
});

describe('durationType display', () => {
  const cell = (value: unknown, language = 'en') =>
    (
      durationType.display!({
        field: COOLDOWN,
        value: () => value,
        language: () => language,
      } as never) as unknown as () => FakeElement | string
    )();

  it('reads in the dashboard language, the typeable text as its title', () => {
    const shown = cell(5_400_000, 'de') as FakeElement;
    strictEqual(shown.textContent, '1h, 30 Min.');
    strictEqual(shown.getAttribute('title'), '1h 30m');
  });

  it('shows a stored negative as it is', () => {
    strictEqual(cell(-1), '-1');
  });
});

describe('durationType filter', () => {
  it('shows a string restored from a URL as text, and only ever sets milliseconds', () => {
    effectScope().run(() => {
      const value = ref<unknown>('2h');
      const written: unknown[] = [];
      const input = durationType.filter!.input({
        field: COOLDOWN,
        operator: () => 'lt',
        value: () => value.value,
        set: (next: unknown) => {
          written.push(next);
          value.value = next;
        },
        commit() {},
        inputID: 'cooldown',
        language: () => 'en',
      } as never);
      flush();
      strictEqual(text(input), '2h');
      for (const step of ['', '4', '45', '45m']) {
        type(inputOf(input), step);
        strictEqual(text(input), step);
      }
      deepStrictEqual(written, [2_700_000]);
    });
  });
});
