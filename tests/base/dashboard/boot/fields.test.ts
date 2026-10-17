import { strictEqual } from 'node:assert';
import { before, describe, it } from 'node:test';

import type { DashboardField } from '../../../../src/dashboard/runtime/meta-types.ts';

import { flush } from '../../../../src/utils/reactive/_scheduler.ts';
import { FakeElement, findElement } from '../../../dashboard/_fake-dom.ts';
import { baseBrowser } from '../_browser.ts';
import { clicks } from '../components/_clicks.ts';

type FieldTypes = typeof import('../../../../src/dashboard/fields/field-type.ts');

describe('the `password` control', () => {
  let fieldTypeFor!: FieldTypes['fieldTypeFor'];

  before(async () => {
    baseBrowser('/');
    clicks();
    Object.assign(FakeElement.prototype, {
      querySelector(this: FakeElement, tag: string) {
        return findElement(this, (element) => element.tagName === tag.toUpperCase()) ?? null;
      },
    });
    await import('../../../../src/base/dashboard/boot/fields.ts');
    ({ fieldTypeFor } = await import('../../../../src/dashboard/fields/field-type.ts'));
  });

  it('names the reveal toggle after its state', () => {
    const field = { name: 'password', type: 'password' } as DashboardField;
    const control = fieldTypeFor(field).control?.({
      field,
      initial: undefined,
      mode: 'create',
      path: 'password',
      language: () => 'en',
      onInput() {},
    });
    flush();
    const root = control?.element as unknown as FakeElement;
    const reveal = findElement(root, (element) => element.attributes.has('aria-pressed'));
    strictEqual(reveal?.getAttribute('aria-pressed'), 'false');
    strictEqual(reveal?.getAttribute('aria-label'), 'dashboard.field.showPassword');
    (reveal as unknown as { click(): void }).click();
    flush();
    strictEqual(reveal?.getAttribute('aria-pressed'), 'true');
    strictEqual(reveal?.getAttribute('aria-label'), 'dashboard.field.hidePassword');
  });

  it('drafts its text, empty included, so an undo never reaches for the stored hash', () => {
    const field = { name: 'password', type: 'password' } as DashboardField;
    const control = fieldTypeFor(field).control?.({
      field,
      initial: 'scrypt$32768$8$1$salt$hash',
      mode: 'edit',
      path: 'password',
      language: () => 'en',
      onInput() {},
    });
    flush();
    strictEqual(control?.draft?.(), '');
    control?.restore?.('s3cret!');
    strictEqual(control?.draft?.(), 's3cret!');
    control?.restore?.('');
    strictEqual(control?.draft?.(), '');
  });
});
