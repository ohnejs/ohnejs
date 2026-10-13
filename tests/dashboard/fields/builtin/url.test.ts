import { deepStrictEqual, strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import type { DashboardField } from '../../../../src/dashboard/runtime/meta-types.ts';

import { flush } from '../../../../src/utils/reactive/_scheduler.ts';
import { effectScope } from '../../../../src/utils/reactive/effect-scope.ts';
import { type FakeElement, findElement } from '../../_fake-dom.ts';
import { fire } from '../../ui/_events.ts';
import { inputOf, type } from '../_controls.ts';

const { urlType } = await import('../../../../src/dashboard/fields/builtin/url.ts');

const field: DashboardField = {
  name: 'site',
  type: 'url',
  kind: 'column',
  label: 'Site',
  nullable: false,
  required: true,
  unique: false,
  translatable: false,
  readable: true,
  writable: true,
  immutable: false,
  options: {},
};

function control(initial: unknown = 'https://dalaran.example') {
  return urlType.control!({
    field,
    initial,
    mode: 'edit',
    path: 'site',
    language: () => 'en',
    onInput() {},
  })!;
}

const hrefOf = (root: unknown) =>
  (
    findElement(root as FakeElement, (element) => element.getAttribute('href') !== null) as
      | FakeElement
      | undefined
  )?.getAttribute('href');

describe('urlType control', () => {
  it('writes the stored form of a typed address', () => {
    effectScope().run(() => {
      const site = control();
      type(inputOf(site.element), 'HTTPS://Orgrimmar.Example:443/Hall');
      deepStrictEqual(site.read(), { value: 'https://orgrimmar.example/Hall' });
    });
  });

  it('reads a bare host as `https://` and keeps the text as typed', () => {
    effectScope().run(() => {
      const site = control();
      const input = inputOf(site.element);
      type(input, 'orgrimmar.example');
      deepStrictEqual(site.read(), { value: 'https://orgrimmar.example' });
      fire(input, 'blur');
      flush();
      strictEqual((input as unknown as { value: string }).value, 'orgrimmar.example');
    });
  });

  it('omits a new value of only spaces', () => {
    effectScope().run(() => {
      const site = urlType.control!({
        field,
        initial: undefined,
        mode: 'create',
        path: 'site',
        language: () => 'en',
        onInput() {},
      })!;
      type(inputOf(site.element), '   ');
      deepStrictEqual(site.read(), {});
      strictEqual(site.dirty(), false);
    });
  });

  it('refuses a local host with the server rule', () => {
    effectScope().run(() => {
      const site = control();
      type(inputOf(site.element), 'localhost:3000');
      deepStrictEqual(site.read(), { errors: { '': 'validation.invalidURL' } });
    });
  });

  it('offers to open only a valid address', () => {
    effectScope().run(() => {
      const site = control();
      strictEqual(hrefOf(site.element), 'https://dalaran.example');
      strictEqual(inputOf(site.element).getAttribute('inputmode'), 'url');
      type(inputOf(site.element), 'https://127.0.0.1');
      strictEqual(hrefOf(site.element), undefined);
    });
  });
});
