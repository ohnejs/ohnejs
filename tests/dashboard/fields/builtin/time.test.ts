import { deepStrictEqual, strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import type { DashboardField } from '../../../../src/dashboard/runtime/meta-types.ts';

import { flush } from '../../../../src/utils/reactive/_scheduler.ts';
import { effectScope } from '../../../../src/utils/reactive/effect-scope.ts';
import { type FakeElement, findElement, hasClass } from '../../_fake-dom.ts';
import '../_controls.ts';

const { timeType } = await import('../../../../src/dashboard/fields/builtin/time.ts');

const field = (nullable: boolean): DashboardField => ({
  name: 'sendAt',
  type: 'time',
  kind: 'column',
  label: 'Send at',
  nullable,
  required: !nullable,
  unique: false,
  translatable: false,
  readable: true,
  writable: true,
  immutable: false,
  options: {},
});

function control(initial: unknown, nullable = true) {
  return timeType.control!({
    field: field(nullable),
    initial,
    mode: 'edit',
    path: 'sendAt',
    language: () => 'en',
    onInput() {},
  })!;
}

const segments = (root: unknown): string[] => {
  const values: string[] = [];
  findElement(root as FakeElement, (element) => {
    if (hasClass(element, 'ohne-number-input')) {
      values.push((element as unknown as { value: string }).value);
    }
    return false;
  });
  return values;
};

describe('timeType control', () => {
  it('restores a clock into the segments, dirty against the stored one', () => {
    effectScope().run(() => {
      const sendAt = control('10:00:00');
      sendAt.restore?.('12:34:56');
      flush();
      deepStrictEqual(segments(sendAt.element), ['12', '34', '56']);
      deepStrictEqual(sendAt.read(), { value: '12:34:56' });
      strictEqual(sendAt.dirty(), true);
      sendAt.restore?.('10:00:00');
      strictEqual(sendAt.dirty(), false);
    });
  });

  it('restores `null` against a stored clock, reading `null` and dirty', () => {
    effectScope().run(() => {
      const sendAt = control('10:00:00');
      sendAt.restore?.(null);
      deepStrictEqual(sendAt.read(), { value: null });
      strictEqual(sendAt.dirty(), true);
      const fresh = control(undefined);
      fresh.restore?.('01:02:03');
      deepStrictEqual(fresh.read(), { value: '01:02:03' });
      fresh.restore?.(undefined);
      deepStrictEqual(fresh.read(), {});
      strictEqual(fresh.dirty(), false);
    });
  });
});
