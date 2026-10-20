import { deepStrictEqual, strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import type { DashboardField } from '../../../../src/dashboard/runtime/meta-types.ts';

import { flush } from '../../../../src/utils/reactive/_scheduler.ts';
import { effectScope } from '../../../../src/utils/reactive/effect-scope.ts';
import { type FakeElement, findElement, hasClass } from '../../_fake-dom.ts';
import { fire } from '../../ui/_events.ts';
import '../_controls.ts';

const { booleanType } = await import('../../../../src/dashboard/fields/builtin/boolean.ts');

const field = (nullable: boolean): DashboardField => ({
  name: 'featured',
  type: 'boolean',
  kind: 'column',
  logicalType: 'boolean',
  label: 'Featured',
  nullable,
  required: !nullable,
  unique: false,
  translatable: false,
  readable: true,
  writable: true,
  immutable: false,
  options: { display: 'switch' },
});

function control(
  initial: unknown,
  nullable = true,
  onInput: (discrete?: boolean) => void = () => {},
) {
  return booleanType.control!({
    field: field(nullable),
    initial,
    mode: 'edit',
    path: 'featured',
    language: () => 'en',
    onInput,
  })!;
}

const knobOf = (root: unknown): FakeElement & { checked: boolean } =>
  findElement(root as FakeElement, (element) =>
    hasClass(element, 'ohne-switch-control'),
  ) as FakeElement & { checked: boolean };

describe('booleanType control', () => {
  it('restores `null` against a stored `true`, reading `null` and dirty, with the switch off', () => {
    effectScope().run(() => {
      const featured = control(true);
      featured.restore?.(null);
      flush();
      deepStrictEqual(featured.read(), { value: null });
      strictEqual(featured.dirty(), true);
      strictEqual(knobOf(featured.element).checked, false);
      featured.restore?.(true);
      flush();
      deepStrictEqual(featured.read(), { value: true });
      strictEqual(featured.dirty(), false);
      strictEqual(knobOf(featured.element).checked, true);
    });
  });

  it('restores none to pristine, and a stored `null` stays `null` until toggled', () => {
    effectScope().run(() => {
      const fresh = control(undefined);
      fresh.restore?.(false);
      deepStrictEqual(fresh.read(), { value: false });
      fresh.restore?.(undefined);
      deepStrictEqual(fresh.read(), {});
      strictEqual(fresh.dirty(), false);
      const stored = control(null);
      deepStrictEqual(stored.read(), { value: null });
      strictEqual(stored.dirty(), false);
    });
  });

  it('reads an untouched new required field as the `false` it shows', () => {
    effectScope().run(() => {
      deepStrictEqual(control(undefined, false).read(), { value: false });
      deepStrictEqual(control(undefined, true).read(), {});
      const defaulted = booleanType.control!({
        field: { ...field(false), required: false },
        initial: undefined,
        mode: 'create',
        path: 'featured',
        language: () => 'en',
        onInput() {},
      })!;
      deepStrictEqual(defaulted.read(), {});
    });
  });

  it('lands a toggle as a discrete change', () => {
    effectScope().run(() => {
      const seen: (boolean | undefined)[] = [];
      const featured = control(false, false, (discrete) => seen.push(discrete));
      const knob = knobOf(featured.element);
      knob.checked = true;
      fire(knob, 'change');
      flush();
      deepStrictEqual(seen, [true]);
      deepStrictEqual(featured.read(), { value: true });
      strictEqual(featured.dirty(), true);
    });
  });
});
