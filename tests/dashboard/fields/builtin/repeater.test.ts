import { deepStrictEqual, ok, strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import type { DashboardField } from '../../../../src/dashboard/runtime/meta-types.ts';

import { isNumber } from '../../../../src/utils/is/is-number.ts';
import { flush, nextTick } from '../../../../src/utils/reactive/_scheduler.ts';
import { effectScope } from '../../../../src/utils/reactive/effect-scope.ts';
import { type FakeElement, findElement, hasClass } from '../../_fake-dom.ts';
import { fire } from '../../ui/_events.ts';
import {
  buttonLabelled,
  focusIn,
  mount,
  pick,
  settle,
  shownInputs,
  toggleCard,
  trackFocus,
} from '../_cards.ts';
import { inputOf, type } from '../_controls.ts';

const { createFieldForm } = await import('../../../../src/dashboard/fields/field-form.ts');
const { h } = await import('../../../../src/dashboard/render/h.ts');
await import('../../../../src/dashboard/fields/builtin/text.ts');
await import('../../../../src/dashboard/fields/builtin/repeater.ts');

const text = (name: string, overrides: Partial<DashboardField> = {}): DashboardField => ({
  name,
  type: 'text',
  kind: 'column',
  logicalType: 'text',
  label: name,
  nullable: false,
  required: true,
  unique: false,
  translatable: false,
  readable: true,
  writable: true,
  immutable: false,
  ...overrides,
});

const FAQ: DashboardField = {
  ...text('faq', { required: false }),
  type: 'repeater',
  kind: 'childMany',
  logicalType: undefined,
  options: { min: 2 },
  subfields: [text('question', { required: false }), text('answer')],
};

const language = (): string => 'en';

const QUESTS = { ...FAQ, name: 'quests', options: {}, subfields: [text('question')] };

type Item = Record<string, unknown>;

/**
 * Every rendered input under `root`, in document order.
 */
function inputsOf(root: unknown): FakeElement[] {
  const inputs: FakeElement[] = [];
  findElement(root as FakeElement, (element) => {
    if (element.tagName === 'INPUT') inputs.push(element);
    return false;
  });
  return inputs;
}

/**
 * The body of the `index`-th card under `root`, where its item's focus is tracked.
 */
function bodyOf(root: unknown, index: number): FakeElement {
  let seen = 0;
  return findElement(
    root as FakeElement,
    (element) => hasClass(element, 'ohne-repeater-item') && seen++ === index,
  ) as FakeElement;
}

trackFocus();

const ACTS: DashboardField = {
  ...QUESTS,
  name: 'acts',
  subfields: [text('title'), { ...QUESTS, name: 'scenes', subfields: [text('line')] }],
};

describe('repeaterType control', () => {
  it('drafts every item as the user has it, the count and required checks aside', () => {
    effectScope().run(() => {
      const form = createFieldForm(
        [FAQ],
        { faq: [{ UUID: 'q1' }] },
        { mode: 'edit', path: '', language },
      );
      const element = h('div', null, form.render());
      type(inputOf(element), 'Who sits on the Frozen Throne?');
      deepStrictEqual(form.controlOf('faq')?.draft?.(), [
        { question: 'Who sits on the Frozen Throne?', UUID: 'q1' },
      ]);
      deepStrictEqual(structuredClone(form.read()), {
        errors: { 'faq[0].answer': 'validation.required' },
      });
    });
  });

  it('refuses a changed list below `min` on read, but drafts it whole', () => {
    effectScope().run(() => {
      const form = createFieldForm(
        [FAQ],
        { faq: [{ UUID: 'q1', question: 'Why?', answer: 'Because.' }] },
        { mode: 'edit', path: '', language },
      );
      const element = h('div', null, form.render());
      type(inputOf(element), 'How?');
      deepStrictEqual(structuredClone(form.read()), { errors: { faq: 'validation.minItems' } });
      deepStrictEqual(form.controlOf('faq')?.draft?.(), [
        { question: 'How?', answer: 'Because.', UUID: 'q1' },
      ]);
    });
  });

  it('drafts nothing while pristine over none', () => {
    effectScope().run(() => {
      const form = createFieldForm([FAQ], undefined, { mode: 'create', path: '', language });
      strictEqual(form.controlOf('faq')?.draft?.(), undefined);
      deepStrictEqual(form.draft(), {});
    });
  });

  it('drafts a fresh item with its `$key`, which a copy of it sheds', () => {
    effectScope().run(() => {
      const form = createFieldForm([QUESTS], undefined, { mode: 'create', path: '', language });
      const element = h('div', null, form.render());
      fire(buttonLabelled(element, 'dashboard.addItem'), 'click');
      flush();
      type(inputOf(element), 'Ashes');
      const [fresh] = (form.controlOf('quests')?.draft?.() ?? []) as Item[];
      ok(isNumber(fresh?.$key));
      deepStrictEqual(fresh, { question: 'Ashes', $key: fresh?.$key });
      form.controlOf('quests')?.restore?.([fresh, { question: 'Ashes' }]);
      flush();
      const [, copy] = (form.controlOf('quests')?.draft?.() ?? []) as Item[];
      ok(isNumber(copy?.$key) && copy?.$key !== fresh?.$key);
      deepStrictEqual(structuredClone(form.read()), {
        value: { quests: [{ question: 'Ashes' }, { question: 'Ashes' }] },
      });
    });
  });

  it('carries each collapsed item into a rebuilt form, by `UUID` and else by the `$key` its draft carries', () => {
    effectScope().run(() => {
      const stored = {
        quests: [{ UUID: 'q1', question: 'Ashes' }, { question: 'Bone' }, { question: 'Cinder' }],
      };
      const form = createFieldForm([QUESTS], stored, { mode: 'edit', path: '', language });
      const element = h('div', null, form.render());
      toggleCard(element, 0);
      toggleCard(element, 2);
      deepStrictEqual(shownInputs(element), ['Bone']);
      const drafted = form.draft();
      const [, bone, cinder] = drafted.quests as Item[];
      const folds = form.folds();
      deepStrictEqual(folds, {
        children: {
          quests: {
            children: {
              q1: { children: {}, collapsed: true },
              [String(bone?.$key)]: { children: {}, collapsed: false },
              [String(cinder?.$key)]: { children: {}, collapsed: true },
            },
          },
        },
      });
      form.dispose();
      const rebuilt = createFieldForm([QUESTS], drafted, {
        mode: 'edit',
        path: '',
        language,
        folds,
      });
      deepStrictEqual(shownInputs(h('div', null, rebuilt.render())), ['Bone']);
      deepStrictEqual(rebuilt.draft(), drafted);
    });
  });

  it('carries a nested fold under its own item, whatever key the rebuilt row gets', () => {
    effectScope().run(() => {
      const stored = {
        acts: [
          {
            UUID: 'a1',
            title: 'Wrath',
            scenes: [
              { UUID: 's1', line: 'Gate' },
              { UUID: 's2', line: 'Throne' },
            ],
          },
        ],
      };
      const form = createFieldForm([ACTS], stored, { mode: 'edit', path: '', language });
      const element = h('div', null, form.render());
      toggleCard(element, 1);
      deepStrictEqual(shownInputs(element), ['Wrath', 'Throne']);
      const folds = form.folds();
      form.dispose();
      const rebuilt = createFieldForm([ACTS], stored, { mode: 'edit', path: '', language, folds });
      deepStrictEqual(shownInputs(h('div', null, rebuilt.render())), ['Wrath', 'Throne']);
    });
  });

  it('restores items in place by `UUID`, keeping their forms, their nodes, and their folds', () => {
    effectScope().run(() => {
      const stored = {
        quests: [
          { UUID: 'q1', question: 'Ashes' },
          { UUID: 'q2', question: 'Bone' },
        ],
      };
      const form = createFieldForm([QUESTS], stored, { mode: 'edit', path: '', language });
      const element = h('div', null, form.render());
      toggleCard(element, 0);
      const control = form.controlOf('quests')!;
      const input = inputOf(element) as FakeElement & { value: string };
      strictEqual(input.value, 'Bone');
      type(input, 'Bones');
      control.restore?.([
        { UUID: 'q1', question: 'Ash' },
        { UUID: 'q2', question: 'Bone' },
      ]);
      flush();
      strictEqual(inputOf(element), input);
      strictEqual(input.value, 'Bone');
      deepStrictEqual(shownInputs(element), ['Bone']);
      deepStrictEqual(control.draft?.(), [
        { question: 'Ash', UUID: 'q1' },
        { question: 'Bone', UUID: 'q2' },
      ]);
      strictEqual(control.dirty(), true);
      control.restore?.(stored.quests);
      strictEqual(control.dirty(), false);
    });
  });

  it('restores a reorder by moving the kept forms, and reads clean once it is undone', () => {
    effectScope().run(() => {
      const stored = {
        quests: [
          { UUID: 'q1', question: 'Ashes' },
          { UUID: 'q2', question: 'Bone' },
        ],
      };
      const form = createFieldForm([QUESTS], stored, { mode: 'edit', path: '', language });
      const element = h('div', null, form.render());
      const control = form.controlOf('quests')!;
      const [ashes, bone] = inputsOf(element);
      control.restore?.([stored.quests[1], stored.quests[0]]);
      flush();
      deepStrictEqual(inputsOf(element), [bone, ashes]);
      deepStrictEqual(shownInputs(element), ['Bone', 'Ashes']);
      strictEqual(control.dirty(), true);
      control.restore?.(stored.quests);
      flush();
      deepStrictEqual(inputsOf(element), [ashes, bone]);
      strictEqual(control.dirty(), false);
    });
  });

  it('restores a reorder of fresh items by their `$key`, moving their forms instead of rewriting them', () => {
    effectScope().run(() => {
      const stored = { quests: [{ UUID: 'q1', question: 'Ashes' }] };
      const form = createFieldForm([QUESTS], stored, { mode: 'edit', path: '', language });
      const element = h('div', null, form.render());
      const control = form.controlOf('quests')!;
      control.restore?.([stored.quests[0], { question: 'Alpha' }, { question: 'Beta' }]);
      flush();
      const [ashes, alpha, beta] = inputsOf(element);
      const [, a, b] = (control.draft?.() ?? []) as Item[];
      toggleCard(element, 1);
      control.restore?.([stored.quests[0], b, a]);
      flush();
      deepStrictEqual(inputsOf(element), [ashes, beta]);
      deepStrictEqual(shownInputs(element), ['Ashes', 'Beta']);
      control.restore?.([stored.quests[0], a, b]);
      flush();
      deepStrictEqual(inputsOf(element), [ashes, beta]);
      toggleCard(element, 1);
      deepStrictEqual(inputsOf(element), [ashes, alpha, beta]);
      deepStrictEqual(shownInputs(element), ['Ashes', 'Alpha', 'Beta']);
    });
  });

  it('drops exactly the copy an undo of a duplicate takes out, while another fresh item stays', () => {
    effectScope().run(() => {
      const stored = { quests: [{ UUID: 'q1', question: 'Ashes' }] };
      const form = createFieldForm([QUESTS], stored, { mode: 'edit', path: '', language });
      const element = h('div', null, form.render());
      const control = form.controlOf('quests')!;
      control.restore?.([stored.quests[0], { question: 'Alpha' }, { question: 'Beta' }]);
      flush();
      const [ashes, alpha, beta] = inputsOf(element);
      const [, a, b] = (control.draft?.() ?? []) as Item[];
      control.restore?.([stored.quests[0], a, { question: 'Beta' }, b]);
      flush();
      const [, , copy] = inputsOf(element);
      deepStrictEqual(inputsOf(element), [ashes, alpha, copy, beta]);
      control.restore?.([stored.quests[0], a, b]);
      flush();
      deepStrictEqual(inputsOf(element), [ashes, alpha, beta]);
      deepStrictEqual(shownInputs(element), ['Ashes', 'Alpha', 'Beta']);
    });
  });

  it('restores a fresh item by its `$key`, drops one the state no longer holds, and rebuilds a stored one over its base', () => {
    effectScope().run(() => {
      const stored = {
        quests: [
          { UUID: 'q1', question: 'Ashes' },
          { UUID: 'q2', question: 'Bone' },
        ],
      };
      const form = createFieldForm([QUESTS], stored, { mode: 'edit', path: '', language });
      const element = h('div', null, form.render());
      const control = form.controlOf('quests')!;
      const [ashes] = inputsOf(element);
      control.restore?.([stored.quests[0], { question: 'Cinder' }]);
      flush();
      deepStrictEqual(shownInputs(element), ['Ashes', 'Cinder']);
      strictEqual(inputsOf(element)[0], ashes);
      const [, cinder] = inputsOf(element);
      const [, drafted] = (control.draft?.() ?? []) as Item[];
      control.restore?.([stored.quests[0], { ...drafted, question: 'Cinders' }]);
      flush();
      strictEqual(inputsOf(element)[1], cinder);
      deepStrictEqual(shownInputs(element), ['Ashes', 'Cinders']);
      strictEqual(control.dirty(), true);
      control.restore?.([stored.quests[0], { UUID: 'q2', question: 'Bones' }]);
      flush();
      deepStrictEqual(shownInputs(element), ['Ashes', 'Bones']);
      strictEqual(control.dirty(), true);
      control.restore?.(stored.quests);
      strictEqual(control.dirty(), false);
    });
  });

  it('keys a fold by the `UUID` a save gave the item', () => {
    effectScope().run(() => {
      const form = createFieldForm(
        [QUESTS],
        { quests: [{ question: 'Ashes' }] },
        {
          mode: 'edit',
          path: '',
          language,
        },
      );
      const element = h('div', null, form.render());
      form.rebase({ quests: [{ UUID: 'q1', question: 'Ashes' }] });
      toggleCard(element, 0);
      deepStrictEqual(form.folds(), {
        children: { quests: { children: { q1: { children: {}, collapsed: true } } } },
      });
    });
  });

  it('hands focus to the next item after Delete, else the previous, else the Add item button', async () => {
    await effectScope().run(async () => {
      const stored = {
        quests: [
          { UUID: 'q1', question: 'Ashes' },
          { UUID: 'q2', question: 'Bone' },
          { UUID: 'q3', question: 'Cinder' },
        ],
      };
      const form = createFieldForm([QUESTS], stored, { mode: 'edit', path: '', language });
      const element = h('div', null, form.render());
      flush();
      const [, bone] = inputsOf(element);
      await pick(element, 0, 'dashboard.delete');
      strictEqual(document.activeElement, bone);
      await pick(element, 1, 'dashboard.clipboard.cut');
      strictEqual(document.activeElement, bone);
      deepStrictEqual(shownInputs(element), ['Bone']);
      await pick(element, 0, 'dashboard.delete');
      strictEqual(document.activeElement, buttonLabelled(element, 'dashboard.addItem'));
    });
  });

  it('focuses the new item after Duplicate and after Add after', async () => {
    await effectScope().run(async () => {
      const stored = { quests: [{ UUID: 'q1', question: 'Ashes' }] };
      const form = createFieldForm([QUESTS], stored, { mode: 'edit', path: '', language });
      const element = h('div', null, form.render());
      flush();
      await pick(element, 0, 'dashboard.duplicate');
      deepStrictEqual(shownInputs(element), ['Ashes', 'Ashes']);
      strictEqual(document.activeElement, inputsOf(element)[0]);
      await pick(element, 1, 'dashboard.sort.addAfter');
      deepStrictEqual(shownInputs(element), ['Ashes', 'Ashes', '']);
      strictEqual(document.activeElement, inputsOf(element)[2]);
    });
  });

  it('brings a removed item back on undo with its own controls and its fold', () => {
    effectScope().run(() => {
      const stored = {
        quests: [
          { UUID: 'q1', question: 'Ashes' },
          { UUID: 'q2', question: 'Bone' },
        ],
      };
      const form = createFieldForm([QUESTS], stored, { mode: 'edit', path: '', language });
      const element = h('div', null, form.render());
      const control = form.controlOf('quests')!;
      const [ashes] = inputsOf(element);
      toggleCard(element, 0);
      control.restore?.([stored.quests[1]]);
      flush();
      deepStrictEqual(shownInputs(element), ['Bone']);
      control.restore?.(stored.quests);
      flush();
      deepStrictEqual(shownInputs(element), ['Bone']);
      toggleCard(element, 0);
      strictEqual(inputsOf(element)[0], ashes);
      strictEqual(control.dirty(), false);
    });
  });

  it('keeps a fresh item collapsed through the undo that drops it and the redo that brings it back', () => {
    effectScope().run(() => {
      const stored = { quests: [{ UUID: 'q1', question: 'Ashes' }] };
      const form = createFieldForm([QUESTS], stored, { mode: 'edit', path: '', language });
      const element = h('div', null, form.render());
      const control = form.controlOf('quests')!;
      control.restore?.([stored.quests[0], { question: 'Ashes' }]);
      flush();
      toggleCard(element, 1);
      const copy = control.draft?.();
      deepStrictEqual(shownInputs(element), ['Ashes']);
      control.restore?.(stored.quests);
      flush();
      control.restore?.(copy);
      flush();
      deepStrictEqual(shownInputs(element), ['Ashes']);
      deepStrictEqual(control.draft?.(), copy);
    });
  });

  it('returns focus to the Add item button when an undo drops the item it added', async () => {
    await effectScope().run(async () => {
      const stored = { quests: [{ UUID: 'q1', question: 'Ashes' }] };
      const form = createFieldForm([QUESTS], stored, { mode: 'edit', path: '', language });
      const root = mount(h('div', null, form.render()) as unknown as FakeElement);
      flush();
      const add = buttonLabelled(root, 'dashboard.addItem');
      (add as unknown as HTMLElement).focus();
      fire(add, 'click');
      flush();
      await nextTick();
      const [, fresh] = inputsOf(root);
      strictEqual(document.activeElement, fresh);
      focusIn(bodyOf(root, 1), fresh as FakeElement);
      form.controlOf('quests')?.restore?.(stored.quests);
      await settle();
      strictEqual(document.activeElement, add);
    });
  });

  it('puts focus back on the control the user was in when an undo brings a deleted item back', async () => {
    await effectScope().run(async () => {
      const stored = {
        quests: [
          { UUID: 'q1', question: 'Ashes' },
          { UUID: 'q2', question: 'Bone' },
          { UUID: 'q3', question: 'Cinder' },
        ],
      };
      const form = createFieldForm([QUESTS], stored, { mode: 'edit', path: '', language });
      const root = mount(h('div', null, form.render()) as unknown as FakeElement);
      flush();
      const [, bone, cinder] = inputsOf(root);
      focusIn(bodyOf(root, 2), cinder as FakeElement);
      await pick(root, 2, 'dashboard.delete');
      strictEqual(document.activeElement, bone);
      form.controlOf('quests')?.restore?.(stored.quests);
      await settle();
      strictEqual(document.activeElement, cinder);
      strictEqual(inputsOf(root)[2], cinder);
    });
  });

  it('hands focus on as the delete did when a redo drops the deleted item again', async () => {
    await effectScope().run(async () => {
      const stored = {
        quests: [
          { UUID: 'q1', question: 'Ashes' },
          { UUID: 'q2', question: 'Bone' },
          { UUID: 'q3', question: 'Cinder' },
        ],
      };
      const form = createFieldForm([QUESTS], stored, { mode: 'edit', path: '', language });
      const root = mount(h('div', null, form.render()) as unknown as FakeElement);
      flush();
      const [, bone, cinder] = inputsOf(root);
      focusIn(bodyOf(root, 2), cinder as FakeElement);
      await pick(root, 2, 'dashboard.delete');
      const control = form.controlOf('quests')!;
      control.restore?.(stored.quests);
      await settle();
      focusIn(bodyOf(root, 2), cinder as FakeElement);
      control.restore?.(stored.quests.slice(0, 2));
      await settle();
      strictEqual(document.activeElement, bone);
    });
  });

  it('returns focus to the menu trigger it came from when an undo drops a duplicate', async () => {
    await effectScope().run(async () => {
      const stored = {
        quests: [
          { UUID: 'q1', question: 'Ashes' },
          { UUID: 'q2', question: 'Bone' },
        ],
      };
      const form = createFieldForm([QUESTS], stored, { mode: 'edit', path: '', language });
      const root = mount(h('div', null, form.render()) as unknown as FakeElement);
      flush();
      await pick(root, 1, 'dashboard.duplicate');
      const [, copy] = inputsOf(root);
      strictEqual(document.activeElement, copy);
      focusIn(bodyOf(root, 1), copy as FakeElement);
      form.controlOf('quests')?.restore?.(stored.quests);
      await settle();
      let seen = 0;
      const dots = findElement(
        root,
        (el) => el.getAttribute('aria-label') === 'dashboard.record.moreActions' && seen++ === 1,
      );
      strictEqual(document.activeElement, dots);
    });
  });
});
