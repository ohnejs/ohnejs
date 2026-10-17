import { deepStrictEqual, strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import type { DashboardField } from '../../../../src/dashboard/runtime/meta-types.ts';

import { effectScope } from '../../../../src/utils/reactive/effect-scope.ts';
import '../_controls.ts';

const { dateType } = await import('../../../../src/dashboard/fields/builtin/date.ts');

const PUBLISHED_ON: DashboardField = {
  name: 'publishedOn',
  type: 'date',
  kind: 'column',
  label: 'Published on',
  nullable: true,
  required: false,
  unique: false,
  translatable: false,
  readable: true,
  writable: true,
  immutable: false,
  options: {},
};

function control(initial: unknown) {
  return dateType.control!({
    field: PUBLISHED_ON,
    initial,
    mode: 'edit',
    path: 'publishedOn',
    language: () => 'en',
    onInput() {},
  })!;
}

describe('dateType control', () => {
  it('restores a day in place, dirty against the stored one, and `null` as cleared', () => {
    effectScope().run(() => {
      const publishedOn = control('2024-01-02');
      publishedOn.restore?.('2024-03-04');
      deepStrictEqual(publishedOn.read(), { value: '2024-03-04' });
      strictEqual(publishedOn.dirty(), true);
      publishedOn.restore?.(null);
      deepStrictEqual(publishedOn.read(), { value: null });
      strictEqual(publishedOn.dirty(), true);
      publishedOn.restore?.('2024-01-02');
      strictEqual(publishedOn.dirty(), false);
      const fresh = control(undefined);
      fresh.restore?.(undefined);
      deepStrictEqual(fresh.read(), {});
    });
  });
});
