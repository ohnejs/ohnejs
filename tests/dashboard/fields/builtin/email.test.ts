import { deepStrictEqual, strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import type { DashboardField } from '../../../../src/dashboard/runtime/meta-types.ts';

import { effectScope } from '../../../../src/utils/reactive/effect-scope.ts';
import { ref } from '../../../../src/utils/reactive/ref.ts';
import { type FakeElement, findElement, hasClass } from '../../_fake-dom.ts';
import { inputOf, type } from '../_controls.ts';

const { emailType } = await import('../../../../src/dashboard/fields/builtin/email.ts');

const field = (nullable = false): DashboardField => ({
  name: 'inbox',
  type: 'email',
  kind: 'column',
  label: 'Inbox',
  nullable,
  required: !nullable,
  unique: false,
  translatable: false,
  readable: true,
  writable: true,
  immutable: false,
  options: {},
});

function control(initial: unknown = 'thrall@orgrimmar.example', nullable = false) {
  return emailType.control!({
    field: field(nullable),
    initial,
    mode: 'edit',
    path: 'inbox',
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

describe('emailType control', () => {
  it('writes the stored form and checks it with the server rule', () => {
    effectScope().run(() => {
      const inbox = control();
      type(inputOf(inbox.element), ' Jaina@Dalaran.Example ');
      deepStrictEqual(inbox.read(), { value: 'jaina@dalaran.example' });
      type(inputOf(inbox.element), 'jaina');
      deepStrictEqual(inbox.read(), { errors: { '': 'validation.invalidEmail' } });
    });
  });

  it('is clean when only the case changes', () => {
    effectScope().run(() => {
      const inbox = control();
      type(inputOf(inbox.element), 'Thrall@Orgrimmar.example');
      strictEqual(inbox.dirty(), false);
    });
  });

  it('writes `null` for an emptied nullable field', () => {
    effectScope().run(() => {
      const inbox = control('thrall@orgrimmar.example', true);
      type(inputOf(inbox.element), '');
      deepStrictEqual(inbox.read(), { value: null });
    });
  });

  it('sets the input attributes for an address', () => {
    effectScope().run(() => {
      const input = inputOf(control().element);
      strictEqual(input.getAttribute('inputmode'), 'email');
      strictEqual(input.getAttribute('autocapitalize'), 'off');
      strictEqual(input.getAttribute('type'), 'text');
    });
  });

  it('puts the button beside the input box, not inside it', () => {
    effectScope().run(() => {
      const root = control().element as unknown as FakeElement;
      const box = findElement(root, (element) => hasClass(element, 'ohne-input')) as FakeElement;
      strictEqual(hasClass(root, 'ohne-row'), true);
      strictEqual(hrefOf(box), undefined);
      strictEqual(hrefOf(root), 'mailto:thrall@orgrimmar.example');
    });
  });

  it('offers an encoded `mailto:` only for a valid address', () => {
    effectScope().run(() => {
      const inbox = control('a?b@x.example');
      strictEqual(hrefOf(inbox.element), 'mailto:a%3Fb@x.example');
      type(inputOf(inbox.element), 'nope');
      strictEqual(hrefOf(inbox.element), undefined);
    });
  });
});

describe('emailType display', () => {
  it('shows the address as text with no link', () => {
    effectScope().run(() => {
      const cell = (
        emailType.display!({
          field: field(),
          value: () => 'thrall@orgrimmar.example',
        } as never) as unknown as () => FakeElement
      )();
      strictEqual(cell.tagName, 'SPAN');
      strictEqual(cell.getAttribute('title'), 'thrall@orgrimmar.example');
      strictEqual(hrefOf(cell), undefined);
    });
  });
});

describe('emailType filter', () => {
  it('holds the stored form and shows the text as typed', () => {
    effectScope().run(() => {
      const condition = ref<unknown>('');
      const root = emailType.filter!.input({
        field: field(),
        value: () => condition.value,
        set: (next: unknown) => {
          condition.value = next;
        },
        commit() {},
        inputID: 'inbox-filter',
      } as never) as unknown as FakeElement;
      const input = inputOf(root);
      type(input, 'Thrall@Orgrimmar.example');
      strictEqual(condition.value, 'thrall@orgrimmar.example');
      strictEqual((input as unknown as { value: string }).value, 'Thrall@Orgrimmar.example');
    });
  });
});
