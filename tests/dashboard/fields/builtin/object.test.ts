import { deepStrictEqual, strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { flush, nextTick } from '../../../../src/utils/reactive/_scheduler.ts';
import { effectScope } from '../../../../src/utils/reactive/effect-scope.ts';
import { type FakeElement, findElement, hasClass } from '../../_fake-dom.ts';
import { fire } from '../../ui/_events.ts';
import { mount, shownInputs, toggleCard, trackFocus } from '../_cards.ts';
import { inputOf, type } from '../_controls.ts';

const { createFieldForm } = await import('../../../../src/dashboard/fields/field-form.ts');
const { h } = await import('../../../../src/dashboard/render/h.ts');
await import('../../../../src/dashboard/fields/builtin/text.ts');
await import('../../../../src/dashboard/fields/builtin/object.ts');
await import('../../../../src/dashboard/fields/builtin/repeater.ts');

const text = (name: string, options: Record<string, unknown> = {}) => ({
  name,
  type: 'text',
  kind: 'column',
  label: name,
  nullable: false,
  required: true,
  unique: false,
  translatable: false,
  readable: true,
  writable: true,
  immutable: false,
  ...options,
});

const object = (nullable: boolean) => ({
  ...text('meta'),
  type: 'object',
  kind: 'childOne',
  nullable,
  required: !nullable,
  subfields: [text('tag', { nullable: true, required: false })],
});

const create = (field: unknown) =>
  createFieldForm([field] as never, undefined, { mode: 'create', path: '', language: () => 'en' });

const byClass = (root: unknown, name: string) =>
  findElement(root as FakeElement, (element) => hasClass(element, name)) as FakeElement;

// The rendered text inputs' values; the switch's hidden checkbox has none.
const texts = (root: unknown) => shownInputs(root).filter((value) => value !== undefined);

trackFocus();

describe('object control on create', () => {
  it('reads a pristine required object as its subform value', () => {
    effectScope().run(() => {
      deepStrictEqual(structuredClone(create(object(false)).read()), { value: { meta: {} } });
    });
  });

  it('omits a pristine nullable object', () => {
    effectScope().run(() => {
      deepStrictEqual(structuredClone(create(object(true)).read()), { value: {} });
    });
  });

  it('drafts the subform as the user has it, with a required subfield still empty', () => {
    effectScope().run(() => {
      const field = {
        ...object(false),
        subfields: [text('note', { required: false }), text('title')],
      };
      const form = createFieldForm(
        [field] as never,
        { meta: {} },
        {
          mode: 'edit',
          path: '',
          language: () => 'en',
        },
      );
      const element = h('div', null, form.render());
      deepStrictEqual(form.controlOf('meta')?.draft?.(), {});
      type(inputOf(element), 'Wrath');
      deepStrictEqual(form.controlOf('meta')?.draft?.(), { note: 'Wrath' });
      deepStrictEqual(structuredClone(form.read()), {
        errors: { 'meta.title': 'validation.required' },
      });
      strictEqual(create(object(true)).controlOf('meta')?.draft?.(), undefined);
    });
  });

  it('keeps the toggle knob mounted through its own toggle, as the field input its label names', () => {
    effectScope().run(() => {
      const form = create(object(true));
      const root = h('div', null, form.render());
      const knob = findElement(
        root as unknown as FakeElement,
        (element) => element.getAttribute('role') === 'switch',
      ) as FakeElement;
      const header = knob.parentNode?.parentNode as FakeElement;
      strictEqual((knob as unknown as { id: string }).id, 'field-meta-input');
      strictEqual(knob.getAttribute('aria-labelledby'), 'field-meta-label');
      strictEqual(knob.getAttribute('aria-label'), null);
      strictEqual(
        (
          findElement(header, (el) => el.getAttribute('id') === 'field-meta-label') as unknown as {
            textContent: string;
          }
        ).textContent,
        'meta',
      );
      strictEqual(hasClass(header, 'ohne-object-header'), true);
      const input = byClass(root, 'ohne-switch-control') as FakeElement & { checked: boolean };
      input.checked = true;
      fire(input, 'change');
      flush();
      deepStrictEqual(structuredClone(form.read()), { value: { meta: {} } });
      deepStrictEqual(form.controlOf('meta')?.draft?.(), {});
      strictEqual(knob.parentNode?.parentNode, header);
      strictEqual(header.parentNode?.parentNode, byClass(root, 'ohne-card'));
      strictEqual(byClass(root, 'ohne-card-body').childNodes.length > 2, true);
    });
  });

  it('restores the subform in place, keeping its controls, dirty against the stored values', () => {
    effectScope().run(() => {
      const form = createFieldForm(
        [object(false)] as never,
        { meta: { tag: 'a' } },
        {
          mode: 'edit',
          path: '',
          language: () => 'en',
        },
      );
      const root = h('div', null, form.render());
      const control = form.controlOf('meta')!;
      const input = inputOf(root) as FakeElement & { value: string };
      type(input, 'ab');
      control.restore?.({ tag: 'b' });
      flush();
      strictEqual(inputOf(root), input);
      strictEqual(input.value, 'b');
      deepStrictEqual(control.draft?.(), { tag: 'b' });
      strictEqual(control.dirty(), true);
      control.restore?.({ tag: 'a' });
      strictEqual(control.dirty(), false);
    });
  });

  it('restores `null` and then an object again over the stored base, as a toggle would', () => {
    effectScope().run(() => {
      const seen: (boolean | undefined)[] = [];
      const form = createFieldForm(
        [object(true)] as never,
        { meta: { tag: 'a' } },
        {
          mode: 'edit',
          path: '',
          language: () => 'en',
          onInput: (discrete) => seen.push(discrete),
        },
      );
      const root = h('div', null, form.render());
      const control = form.controlOf('meta')!;
      control.restore?.(null);
      flush();
      deepStrictEqual(control.read(), { value: null });
      strictEqual(control.dirty(), true);
      strictEqual(byClass(root, 'ohne-input-control'), undefined);
      control.restore?.({ tag: 'a' });
      flush();
      deepStrictEqual(control.read(), { value: { tag: 'a' } });
      strictEqual(control.dirty(), false);
      strictEqual((byClass(root, 'ohne-input-control') as unknown as { value: string }).value, 'a');
      deepStrictEqual(seen, []);
      const input = byClass(root, 'ohne-switch-control') as FakeElement & { checked: boolean };
      input.checked = false;
      fire(input, 'change');
      flush();
      deepStrictEqual(seen, [true]);
    });
  });

  it('hands focus to the switch when an undo drops the subform holding it', async () => {
    await effectScope().run(async () => {
      const form = createFieldForm(
        [object(true)] as never,
        { meta: { tag: 'a' } },
        {
          mode: 'edit',
          path: '',
          language: () => 'en',
        },
      );
      const root = mount(h('div', null, form.render()) as unknown as FakeElement);
      const control = form.controlOf('meta')!;
      const knob = findElement(root, (element) => element.getAttribute('role') === 'switch');
      (byClass(root, 'ohne-input-control') as unknown as HTMLElement).focus();
      control.restore?.(null);
      flush();
      await nextTick();
      strictEqual(document.activeElement, knob);
      control.restore?.({ tag: 'a' });
      flush();
      await nextTick();
      strictEqual(document.activeElement, knob);
    });
  });

  it('keeps the folds of a nested list through the undo that turns the object off and back on', () => {
    effectScope().run(() => {
      const field = {
        ...object(true),
        subfields: [
          {
            ...text('quests', { required: false }),
            type: 'repeater',
            kind: 'childMany',
            subfields: [text('question')],
          },
        ],
      };
      const form = create(field);
      const root = h('div', null, form.render());
      const control = form.controlOf('meta')!;
      control.restore?.({ quests: [{ question: 'Ashes' }, { question: 'Bone' }] });
      flush();
      toggleCard(root, 0);
      deepStrictEqual(texts(root), ['Bone']);
      const on = control.draft?.();
      control.restore?.(null);
      flush();
      deepStrictEqual(texts(root), []);
      control.restore?.(on);
      flush();
      deepStrictEqual(texts(root), ['Bone']);
      deepStrictEqual(control.draft?.(), on);
      const input = byClass(root, 'ohne-switch-control') as FakeElement & { checked: boolean };
      input.checked = false;
      fire(input, 'change');
      flush();
      deepStrictEqual(texts(root), []);
      input.checked = true;
      fire(input, 'change');
      flush();
      deepStrictEqual(texts(root), ['Bone']);
    });
  });

  it('carries the folds of a list inside the object into a rebuilt form', () => {
    effectScope().run(() => {
      const field = {
        ...object(false),
        subfields: [
          {
            ...text('quests', { required: false }),
            type: 'repeater',
            kind: 'childMany',
            subfields: [text('question')],
          },
        ],
      };
      const stored = {
        meta: {
          quests: [
            { UUID: 'q1', question: 'Ashes' },
            { UUID: 'q2', question: 'Bone' },
          ],
        },
      };
      const options = { mode: 'edit', path: '', language: () => 'en' } as const;
      const form = createFieldForm([field] as never, stored, options);
      const element = h('div', null, form.render());
      toggleCard(element, 0);
      deepStrictEqual(shownInputs(element), ['Bone']);
      const folds = form.folds();
      form.dispose();
      const rebuilt = createFieldForm([field] as never, stored, { ...options, folds });
      deepStrictEqual(shownInputs(h('div', null, rebuilt.render())), ['Bone']);
    });
  });
});
