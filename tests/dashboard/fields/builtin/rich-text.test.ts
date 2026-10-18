import { deepStrictEqual, strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import type { DashboardField } from '../../../../src/dashboard/runtime/meta-types.ts';
import type { RichText } from '../../../../src/utils/rich-text/rich-text.ts';

import { effectScope } from '../../../../src/utils/reactive/effect-scope.ts';
import { FakeElement, findElement } from '../../_fake-dom.ts';
import '../_controls.ts';

// The editor binds its key and selection listeners on the surface's document.
const owner = Object.assign(Object.create(document), {
  activeElement: null,
  addEventListener() {},
  removeEventListener() {},
});
Object.defineProperty(FakeElement.prototype, 'ownerDocument', { get: () => owner });
Object.assign(FakeElement.prototype, {
  prepend(this: FakeElement, node: FakeElement) {
    this.insertBefore(node, this.childNodes[0] ?? null);
  },
});

const { richTextType } = await import('../../../../src/dashboard/fields/builtin/rich-text.ts');
const { createFieldForm } = await import('../../../../src/dashboard/fields/field-form.ts');

const field = (options: Record<string, unknown> = {}, nullable = false): DashboardField => ({
  name: 'body',
  type: 'richText',
  kind: 'column',
  label: 'Body',
  nullable,
  required: !nullable,
  unique: false,
  translatable: false,
  readable: true,
  writable: true,
  immutable: false,
  options: { links: false, ...options },
});

const paragraph = (text: string): RichText => [{ kind: 'paragraph', content: [{ text }] }];

const list: RichText = [
  {
    kind: 'list',
    ordered: false,
    items: [{ content: [{ text: 'One' }] }, { content: [{ text: 'Two' }] }],
  },
];

const tool = (root: unknown, label: string) =>
  findElement(root as FakeElement, (el) => el.getAttribute('aria-label') === label);

const disabled = (root: unknown, label: string) =>
  tool(root, label)!.getAttribute('disabled') !== null;

function control(initial: unknown, options: Record<string, unknown> = {}, nullable = false) {
  return richTextType.control!({
    field: field(options, nullable),
    initial,
    mode: 'edit',
    path: 'body',
    language: () => 'en',
    onInput() {},
  })!;
}

describe('richTextType control', () => {
  it('drafts a tree over `max` that its read refuses', () => {
    effectScope().run(() => {
      const body = control(paragraph('Ony'), { max: 4 });
      body.restore?.(paragraph('Onyxia'));
      deepStrictEqual(body.read(), { errors: { '': 'validation.maxLength' } });
      deepStrictEqual(body.draft?.(), paragraph('Onyxia'));
    });
  });

  it('lands that tree in a form draft, where a snapshot keeps the fallback', () => {
    effectScope().run(() => {
      const form = createFieldForm(
        [field({ max: 4 })],
        { body: paragraph('Ony') },
        { mode: 'edit', path: '', language: () => 'en' },
      );
      form.restore({ body: paragraph('Onyxia') });
      const fallback = { body: paragraph('Ony') };
      deepStrictEqual(form.snapshot(fallback), fallback);
      deepStrictEqual(form.draft(fallback), { body: paragraph('Onyxia') });
    });
  });

  it('drafts nothing while pristine over none, and `null` once a nullable field empties', () => {
    effectScope().run(() => {
      const fresh = control(undefined, {}, true);
      strictEqual(fresh.draft?.(), undefined);
      const emptied = control(paragraph('Ony'), {}, true);
      emptied.restore?.([]);
      strictEqual(emptied.draft?.(), null);
      deepStrictEqual(emptied.read(), { value: null });
    });
  });

  it('offers indent and outdent while lists are allowed, enabled only as far as the item can move', () => {
    effectScope().run(() => {
      const body = control(list);
      strictEqual(disabled(body.element, 'dashboard.richText.indent'), true);
      strictEqual(disabled(body.element, 'dashboard.richText.outdent'), false);
      const plain = control(paragraph('Ony'), { elements: ['h2'] });
      strictEqual(tool(plain.element, 'dashboard.richText.indent'), undefined);
      strictEqual(tool(plain.element, 'dashboard.richText.outdent'), undefined);
    });
  });
});
