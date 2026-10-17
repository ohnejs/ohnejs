import { deepStrictEqual, strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import type { DashboardField } from '../../../../src/dashboard/runtime/meta-types.ts';
import type { RichText } from '../../../../src/utils/rich-text/rich-text.ts';

import { effectScope } from '../../../../src/utils/reactive/effect-scope.ts';
import { FakeElement } from '../../_fake-dom.ts';
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
});
