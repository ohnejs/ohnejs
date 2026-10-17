import { deepStrictEqual, strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import type { DashboardField } from '../../../../src/dashboard/runtime/meta-types.ts';

import { effectScope } from '../../../../src/utils/reactive/effect-scope.ts';
import '../_controls.ts';

const { dateTimeType } = await import('../../../../src/dashboard/fields/builtin/date-time.ts');

const EMBARGO: DashboardField = {
  name: 'embargo',
  type: 'dateTime',
  kind: 'column',
  label: 'Embargo',
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
  return dateTimeType.control!({
    field: EMBARGO,
    initial,
    mode: 'edit',
    path: 'embargo',
    language: () => 'en',
    onInput() {},
  })!;
}

describe('dateTimeType control', () => {
  it('restores an instant in place, dirty against the stored one, and `null` as cleared', () => {
    effectScope().run(() => {
      const embargo = control(1700000000000);
      embargo.restore?.(1800000000000);
      deepStrictEqual(embargo.read(), { value: 1800000000000 });
      strictEqual(embargo.dirty(), true);
      embargo.restore?.(null);
      deepStrictEqual(embargo.read(), { value: null });
      embargo.restore?.(1700000000000);
      strictEqual(embargo.dirty(), false);
      const fresh = control(undefined);
      fresh.restore?.(undefined);
      deepStrictEqual(fresh.read(), {});
    });
  });
});
