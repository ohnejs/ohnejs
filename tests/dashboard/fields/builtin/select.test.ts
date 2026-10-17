import { deepStrictEqual, strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import type { DashboardField } from '../../../../src/dashboard/runtime/meta-types.ts';

import { flush } from '../../../../src/utils/reactive/_scheduler.ts';
import { effectScope } from '../../../../src/utils/reactive/effect-scope.ts';
import { type FakeElement, findElement, hasClass } from '../../_fake-dom.ts';
import { fire } from '../../ui/_events.ts';
import '../_controls.ts';

const { selectType } = await import('../../../../src/dashboard/fields/builtin/select.ts');

const field = (nullable: boolean, display?: 'buttons'): DashboardField => ({
  name: 'status',
  type: 'select',
  kind: 'column',
  label: 'Status',
  nullable,
  required: !nullable,
  unique: false,
  translatable: false,
  readable: true,
  writable: true,
  immutable: false,
  options: { choices: ['draft', 'published'], ...(display ? { display } : {}) },
});

function control(
  initial: unknown,
  nullable = false,
  display?: 'buttons',
  onInput: (discrete?: boolean) => void = () => {},
) {
  return selectType.control!({
    field: field(nullable, display),
    initial,
    mode: 'edit',
    path: 'status',
    language: () => 'en',
    onInput,
  })!;
}

describe('selectType control', () => {
  it('restores a choice in place, dirty against the stored one', () => {
    effectScope().run(() => {
      const status = control('draft');
      status.restore?.('published');
      deepStrictEqual(status.read(), { value: 'published' });
      strictEqual(status.dirty(), true);
      status.restore?.('draft');
      strictEqual(status.dirty(), false);
      const cleared = control('draft', true);
      cleared.restore?.(null);
      deepStrictEqual(cleared.read(), { value: null });
      strictEqual(cleared.dirty(), true);
      const fresh = control(undefined);
      fresh.restore?.('draft');
      deepStrictEqual(fresh.read(), { value: 'draft' });
      fresh.restore?.(undefined);
      deepStrictEqual(fresh.read(), {});
    });
  });

  it('lands a pick as a discrete change', () => {
    effectScope().run(() => {
      const seen: (boolean | undefined)[] = [];
      const status = control('draft', false, 'buttons', (discrete) => seen.push(discrete));
      const published = findElement(
        status.element as unknown as FakeElement,
        (element) =>
          hasClass(element, 'ohne-button-group-item') && element.textContent.includes('published'),
      ) as FakeElement;
      fire(published, 'click');
      flush();
      deepStrictEqual(seen, [true]);
      deepStrictEqual(status.read(), { value: 'published' });
    });
  });
});
