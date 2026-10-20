import { deepStrictEqual, strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import type { DashboardField } from '../../../../src/dashboard/runtime/meta-types.ts';
import type { FakeElement } from '../../_fake-dom.ts';

import { flush } from '../../../../src/utils/reactive/_scheduler.ts';
import { effectScope } from '../../../../src/utils/reactive/effect-scope.ts';
import { fire } from '../../ui/_events.ts';
import { inputOf, type } from '../_controls.ts';

const { linkType } = await import('../../../../src/dashboard/fields/builtin/link.ts');

const SITE: DashboardField = {
  name: 'site',
  type: 'link',
  kind: 'column',
  label: 'Site',
  nullable: true,
  required: false,
  unique: false,
  translatable: false,
  readable: true,
  writable: true,
  immutable: false,
  options: {},
};

describe('linkType control', () => {
  it('asks a touch keyboard for an address, uncapitalized', () => {
    effectScope().run(() => {
      const control = linkType.control!({
        field: SITE,
        initial: null,
        mode: 'edit',
        path: 'site',
        language: () => 'en',
        onInput: () => {},
      })!;
      const input = inputOf(control.element);
      strictEqual(input.getAttribute('inputmode'), 'url');
      strictEqual(input.getAttribute('autocapitalize'), 'off');
    });
  });

  it('reads an unsafe address as its message without showing it, and shows it on blur', () => {
    effectScope().run(() => {
      const control = linkType.control!({
        field: SITE,
        initial: null,
        mode: 'edit',
        path: 'site',
        language: () => 'en',
        onInput: () => {},
      })!;
      const input = inputOf(control.element);
      type(input, 'javascript:alert(1)');
      deepStrictEqual(control.read(), { errors: { '': 'dashboard.link.unsafeURL' } });
      strictEqual(control.error(), '');
      fire(input, 'blur');
      flush();
      strictEqual(control.error(), 'dashboard.link.unsafeURL');
    });
  });

  it('restores a link into the address input, clearing an unsafe text, and lands typing as a burst', () => {
    effectScope().run(() => {
      const seen: (boolean | undefined)[] = [];
      const control = linkType.control!({
        field: SITE,
        initial: null,
        mode: 'edit',
        path: 'site',
        language: () => 'en',
        onInput: (discrete) => seen.push(discrete),
      })!;
      const input = inputOf(control.element) as FakeElement & { value: string };
      type(input, 'javascript:alert(1)');
      fire(input, 'blur');
      flush();
      deepStrictEqual(seen, [false]);
      control.restore?.({ url: 'https://dalaran.example' });
      flush();
      strictEqual(inputOf(control.element), input);
      strictEqual(input.value, 'https://dalaran.example');
      strictEqual(control.error(), '');
      deepStrictEqual(control.read(), { value: { url: 'https://dalaran.example' } });
      strictEqual(control.dirty(), true);
      control.restore?.(null);
      flush();
      strictEqual(input.value, '');
      deepStrictEqual(control.read(), { value: null });
      strictEqual(control.dirty(), false);
    });
  });
});
