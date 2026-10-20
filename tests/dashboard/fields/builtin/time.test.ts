import { deepStrictEqual, strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import type { DashboardField } from '../../../../src/dashboard/runtime/meta-types.ts';

import { flush } from '../../../../src/utils/reactive/_scheduler.ts';
import { effectScope } from '../../../../src/utils/reactive/effect-scope.ts';
import { type FakeElement, findElement, hasClass } from '../../_fake-dom.ts';
import { fire } from '../../ui/_events.ts';
import '../_controls.ts';

const { timeType } = await import('../../../../src/dashboard/fields/builtin/time.ts');

const field = (nullable: boolean, options: Record<string, unknown> = {}): DashboardField => ({
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
  options,
});

function control(initial: unknown, nullable = true, options: Record<string, unknown> = {}) {
  return timeType.control!({
    field: field(nullable, options),
    initial,
    mode: 'edit',
    path: 'sendAt',
    language: () => 'en',
    onInput() {},
  })!;
}

const clearOf = (root: unknown): FakeElement | undefined =>
  findElement(root as FakeElement, (element) => hasClass(element, 'ohne-time-clear'));

const tab = (root: unknown): void => {
  const hours = findElement(root as FakeElement, (element) =>
    hasClass(element, 'ohne-number-input'),
  )!;
  fire(hours, 'focus');
  fire(hours, 'blur');
  flush();
};

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

  it('seeds a required clock at `min`, reads the time it shows, and stays pristine through a tab', () => {
    effectScope().run(() => {
      const sendAt = control(undefined, false, { min: '08:00' });
      flush();
      deepStrictEqual(segments(sendAt.element), ['08', '00', '00']);
      tab(sendAt.element);
      deepStrictEqual(sendAt.read(), { value: '08:00:00' });
      strictEqual(sendAt.dirty(), false);
      strictEqual(clearOf(sendAt.element), undefined);
      const defaulted = timeType.control!({
        field: { ...field(false, { min: '08:00' }), required: false },
        initial: undefined,
        mode: 'create',
        path: 'sendAt',
        language: () => 'en',
        onInput() {},
      })!;
      deepStrictEqual(defaulted.read(), {});
    });
  });

  it('shows a nullable empty clock empty, and keeps a stored `null` through a tab', () => {
    effectScope().run(() => {
      for (const initial of [undefined, null]) {
        const sendAt = control(initial);
        flush();
        deepStrictEqual(segments(sendAt.element), ['', '', '']);
        tab(sendAt.element);
        deepStrictEqual(sendAt.read(), initial === null ? { value: null } : {});
        strictEqual(sendAt.dirty(), false);
        strictEqual(clearOf(sendAt.element), undefined);
      }
    });
  });

  it('clears a nullable clock to `null`', () => {
    effectScope().run(() => {
      const sendAt = control('10:00:00');
      fire(clearOf(sendAt.element)!, 'click');
      flush();
      deepStrictEqual(sendAt.read(), { value: null });
      strictEqual(sendAt.dirty(), true);
      deepStrictEqual(segments(sendAt.element), ['', '', '']);
      strictEqual(clearOf(sendAt.element), undefined);
    });
  });
});
