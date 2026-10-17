import { deepStrictEqual, strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import type { DashboardField } from '../../../../src/dashboard/runtime/meta-types.ts';

import { flush } from '../../../../src/utils/reactive/_scheduler.ts';
import { effectScope } from '../../../../src/utils/reactive/effect-scope.ts';
import { ref } from '../../../../src/utils/reactive/ref.ts';
import { type FakeElement, findElement, hasClass } from '../../_fake-dom.ts';
import { fire } from '../../ui/_events.ts';
import { type } from '../_controls.ts';

const { colorType } = await import('../../../../src/dashboard/fields/builtin/color.ts');

const field = (options: Record<string, unknown> = {}, nullable = false): DashboardField => ({
  name: 'tint',
  type: 'color',
  kind: 'column',
  label: 'Tint',
  nullable,
  required: !nullable,
  unique: false,
  translatable: false,
  readable: true,
  writable: true,
  immutable: false,
  options,
});

/**
 * The control for `options`, seeded with `initial`.
 */
function control(
  options: Record<string, unknown> = {},
  initial: unknown = '#336699',
  nullable = false,
) {
  return colorType.control!({
    field: field(options, nullable),
    initial,
    mode: 'edit',
    path: 'tint',
    language: () => 'en',
    onInput() {},
  })!;
}

const byClass = (root: unknown, name: string) =>
  findElement(root as FakeElement, (element) => hasClass(element, name)) as FakeElement;

describe('colorType control', () => {
  it('writes the stored form of a typed color', () => {
    effectScope().run(() => {
      const tint = control();
      deepStrictEqual(tint.read(), { value: '#336699' });
      type(byClass(tint.element, 'ohne-input-control'), '#F80');
      deepStrictEqual(tint.read(), { value: '#ff8800' });
      strictEqual(tint.dirty(), true);
      type(byClass(tint.element, 'ohne-input-control'), '#336699FF');
      strictEqual(tint.dirty(), false);
    });
  });

  it('checks a changed color with the server rule', () => {
    effectScope().run(() => {
      const tint = control();
      type(byClass(tint.element, 'ohne-input-control'), '#33669980');
      deepStrictEqual(tint.read(), { errors: { '': 'validation.invalidColor' } });
      type(byClass(tint.element, 'ohne-input-control'), 'teal');
      deepStrictEqual(tint.read(), { errors: { '': 'validation.invalidColor' } });
    });
  });

  it('writes `null` for an emptied nullable field', () => {
    effectScope().run(() => {
      const tint = control({}, '#336699', true);
      type(byClass(tint.element, 'ohne-input-control'), '');
      deepStrictEqual(tint.read(), { value: null });
    });
  });

  it('drafts the text as typed, whole or partial, where `read` writes the stored form', () => {
    effectScope().run(() => {
      const tint = control();
      type(byClass(tint.element, 'ohne-input-control'), '#F80');
      strictEqual(tint.draft?.(), '#F80');
      deepStrictEqual(tint.read(), { value: '#ff8800' });
      type(byClass(tint.element, 'ohne-input-control'), '#12');
      strictEqual(tint.draft?.(), '#12');
      deepStrictEqual(tint.read(), { errors: { '': 'validation.invalidColor' } });
      const nullable = control({}, '#336699', true);
      type(byClass(nullable.element, 'ohne-input-control'), '');
      strictEqual(nullable.draft?.(), null);
      const fresh = colorType.control!({
        field: field(),
        initial: undefined,
        mode: 'create',
        path: 'tint',
        language: () => 'en',
        onInput() {},
      })!;
      strictEqual(fresh.draft?.(), undefined);
    });
  });

  it('sets the alpha channel from the opacity input', () => {
    effectScope().run(() => {
      const tint = control({ alpha: true });
      const opacity = findElement(
        tint.element as unknown as FakeElement,
        (element) =>
          element.tagName === 'INPUT' &&
          element.getAttribute('aria-label') === 'dashboard.color.opacity',
      ) as FakeElement;
      type(opacity, '50');
      fire(opacity, 'blur');
      flush();
      deepStrictEqual(tint.read(), { value: '#33669980' });
    });
  });

  it('picks a swatch, and marks the one the value holds', () => {
    effectScope().run(() => {
      const tint = control({ swatches: ['#F80', '#336699'] });
      const swatches = byClass(tint.element, 'ohne-color-swatches').childNodes as FakeElement[];
      deepStrictEqual(
        swatches.map((swatch) => swatch.getAttribute('aria-pressed')),
        ['false', 'true'],
      );
      fire(swatches[0], 'click');
      flush();
      deepStrictEqual(tint.read(), { value: '#ff8800' });
    });
  });

  it('names each swatch by the field label and its hex, a labelled control of the field like the input', () => {
    effectScope().run(() => {
      const tint = control({ swatches: ['#0070dd', '#a335ee'] });
      const swatches: FakeElement[] = [];
      findElement(tint.element as unknown as FakeElement, (element) => {
        if (hasClass(element, 'ohne-color-swatch')) swatches.push(element);
        return false;
      });
      deepStrictEqual(
        swatches.map((swatch) => [
          (swatch as unknown as { id: string }).id,
          swatch.getAttribute('aria-labelledby'),
          swatch.getAttribute('aria-label'),
        ]),
        [
          ['field-tint-input-swatch-0', 'field-tint-label field-tint-input-swatch-0', '#0070dd'],
          ['field-tint-input-swatch-1', 'field-tint-label field-tint-input-swatch-1', '#a335ee'],
        ],
      );
    });
  });

  it('restores the text as typed into its input, dirty against the stored value', () => {
    effectScope().run(() => {
      const tint = control();
      const input = byClass(tint.element, 'ohne-input-control');
      tint.restore?.('#F80');
      flush();
      strictEqual(byClass(tint.element, 'ohne-input-control'), input);
      strictEqual((input as unknown as { value: string }).value, '#F80');
      deepStrictEqual(tint.read(), { value: '#ff8800' });
      strictEqual(tint.dirty(), true);
      tint.restore?.('#12');
      deepStrictEqual(tint.read(), { errors: { '': 'validation.invalidColor' } });
      tint.restore?.('#336699');
      strictEqual(tint.dirty(), false);
    });
  });

  it('lands a swatch click as a discrete change, and typing as a burst', () => {
    effectScope().run(() => {
      const seen: (boolean | undefined)[] = [];
      const tint = colorType.control!({
        field: field({ swatches: ['#F80'] }),
        initial: '#336699',
        mode: 'edit',
        path: 'tint',
        language: () => 'en',
        onInput: (discrete) => seen.push(discrete),
      })!;
      const swatch = byClass(tint.element, 'ohne-color-swatches').childNodes[0] as FakeElement;
      Object.assign(swatch, {
        closest: (selector: string) => (selector === '.ohne-color-swatch' ? swatch : null),
      });
      // The click reaches the root in the capture phase before the swatch handles it.
      fire(tint.element as unknown as FakeElement, 'click', { target: swatch });
      fire(swatch, 'click');
      type(byClass(tint.element, 'ohne-input-control'), '#123');
      deepStrictEqual(seen, [true, false]);
    });
  });
});

describe('colorType display', () => {
  it('shows a chip beside the stored form, and a malformed value as dim text', () => {
    effectScope().run(() => {
      const cell = (value: unknown) =>
        (
          colorType.display!({
            field: field(),
            value: () => value,
          } as never) as unknown as () => FakeElement
        )();
      strictEqual(cell('#F80').textContent, '#ff8800');
      strictEqual(hasClass(byClass(cell('#F80'), 'ohne-color-chip'), 'ohne-checkerboard'), true);
      strictEqual(hasClass(cell('teal'), 'cell-dim'), true);
    });
  });
});

describe('colorType filter', () => {
  it('holds the stored form on every keystroke, and shows the text as typed', () => {
    effectScope().run(() => {
      const condition = ref<unknown>('');
      const root = colorType.filter!.input({
        field: field(),
        value: () => condition.value,
        set: (next: unknown) => {
          condition.value = next;
        },
        commit() {},
        inputID: 'tint-filter',
      } as never) as unknown as FakeElement;
      const input = byClass(root, 'ohne-input-control');
      type(input, '#F8');
      strictEqual(condition.value, '#F8');
      type(input, '#F80');
      strictEqual(condition.value, '#ff8800');
      strictEqual((input as unknown as { value: string }).value, '#F80');
      condition.value = '#336699';
      flush();
      strictEqual((input as unknown as { value: string }).value, '#336699');
    });
  });
});
