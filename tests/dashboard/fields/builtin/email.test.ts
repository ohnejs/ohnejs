import { deepStrictEqual, strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import type { DashboardField } from '../../../../src/dashboard/runtime/meta-types.ts';

import { flush } from '../../../../src/utils/reactive/_scheduler.ts';
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

const linkOf = (root: unknown) =>
  findElement(root as FakeElement, (element) => element.getAttribute('href') !== null) as
    | FakeElement
    | undefined;

const hrefOf = (root: unknown) => linkOf(root)?.getAttribute('href');

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

  it('drafts the text as typed, valid or not, while `read` writes the stored form', () => {
    effectScope().run(() => {
      const inbox = control();
      type(inputOf(inbox.element), 'Thrall@Orgrimmar.Example');
      strictEqual(inbox.draft?.(), 'Thrall@Orgrimmar.Example');
      deepStrictEqual(inbox.read(), { value: 'thrall@orgrimmar.example' });
      type(inputOf(inbox.element), 'jaina');
      strictEqual(inbox.draft?.(), 'jaina');
      deepStrictEqual(inbox.read(), { errors: { '': 'validation.invalidEmail' } });
    });
  });

  it('snapshots the stored form of an address its read refuses', () => {
    effectScope().run(() => {
      const inbox = control();
      type(inputOf(inbox.element), 'Jaina');
      deepStrictEqual(
        [inbox.snapshot?.(), inbox.read()],
        ['jaina', { errors: { '': 'validation.invalidEmail' } }],
      );
    });
  });

  it('drafts nothing for a pristine control over none, and `null` for an emptied nullable one', () => {
    effectScope().run(() => {
      const fresh = emailType.control!({
        field: field(),
        initial: undefined,
        mode: 'create',
        path: 'inbox',
        language: () => 'en',
        onInput() {},
      })!;
      strictEqual(fresh.draft?.(), undefined);
      const inbox = control('thrall@orgrimmar.example', true);
      type(inputOf(inbox.element), '  ');
      strictEqual(inbox.draft?.(), null);
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

  it('keeps one button mounted, encoded `mailto:` while valid and disabled while not', () => {
    effectScope().run(() => {
      const inbox = control('a?b@x.example');
      const link = linkOf(inbox.element) as FakeElement;
      strictEqual(link.getAttribute('href'), 'mailto:a%3Fb@x.example');
      strictEqual(link.getAttribute('aria-disabled'), null);
      type(inputOf(inbox.element), 'nope');
      strictEqual(linkOf(inbox.element), link);
      strictEqual(link.getAttribute('href'), '');
      strictEqual(link.getAttribute('aria-disabled'), 'true');
      type(inputOf(inbox.element), 'ok@x.example');
      strictEqual(linkOf(inbox.element), link);
      strictEqual(link.getAttribute('href'), 'mailto:ok@x.example');
      strictEqual(link.getAttribute('aria-disabled'), null);
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

  it('restores the text as typed into its input, dirty against the stored value', () => {
    effectScope().run(() => {
      const inbox = control();
      const input = inputOf(inbox.element);
      inbox.restore?.('Jaina@Dalaran.Example');
      flush();
      strictEqual(inputOf(inbox.element), input);
      strictEqual((input as unknown as { value: string }).value, 'Jaina@Dalaran.Example');
      strictEqual(inbox.draft?.(), 'Jaina@Dalaran.Example');
      deepStrictEqual(inbox.read(), { value: 'jaina@dalaran.example' });
      strictEqual(inbox.dirty(), true);
      inbox.restore?.('bob@');
      deepStrictEqual(inbox.read(), { errors: { '': 'validation.invalidEmail' } });
      inbox.restore?.('thrall@orgrimmar.example');
      strictEqual(inbox.dirty(), false);
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
