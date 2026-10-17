import { deepStrictEqual, ok, strictEqual } from 'node:assert';
import { before, describe, it, mock } from 'node:test';

import type { DashboardField } from '../../../../src/dashboard/runtime/meta-types.ts';

import { isNumber } from '../../../../src/utils/is/is-number.ts';
import { flush } from '../../../../src/utils/reactive/_scheduler.ts';
import { effectScope } from '../../../../src/utils/reactive/effect-scope.ts';
import { type FakeElement, findElement, hasClass } from '../../_fake-dom.ts';
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
const { dashboardMeta } = await import('../../../../src/dashboard/runtime/meta.ts');
const { sessionUser } = await import('../../../../src/dashboard/runtime/session.ts');
await import('../../../../src/dashboard/fields/builtin/text.ts');
await import('../../../../src/dashboard/fields/builtin/blocks.ts');

const ADMIN = {
  UUID: 'u',
  email: 'admin@example.com',
  roles: ['admin'],
  dashboardLanguage: null,
  contentLanguage: null,
  timezone: null,
  dateFormat: 'YYYY-MM-DD',
  timeFormat: 'HH:mm',
  smartClipboard: false,
};

const TITLE: DashboardField = {
  name: 'title',
  type: 'text',
  kind: 'column',
  logicalType: 'text',
  label: 'Title',
  nullable: false,
  required: true,
  unique: false,
  translatable: false,
  readable: true,
  writable: true,
  immutable: false,
};

const SECTIONS = {
  ...TITLE,
  name: 'sections',
  type: 'blocks',
  kind: 'childMany',
  logicalType: undefined,
  label: 'Sections',
  required: false,
  allow: ['Hero'],
} as DashboardField;

type Item = Record<string, unknown>;

trackFocus();

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
 * The body of the `index`-th card under `root`, where its block's focus is tracked.
 */
function bodyOf(root: unknown, index: number): FakeElement {
  let seen = 0;
  return findElement(
    root as FakeElement,
    (element) => hasClass(element, 'ohne-blocks-item') && seen++ === index,
  ) as FakeElement;
}

/**
 * Lets the discovery fetches land and runs the effects they queued.
 */
async function fetched(): Promise<void> {
  for (let i = 0; i < 3; i++) await new Promise((resolve) => setImmediate(resolve));
  flush();
}

describe('blocksType control', () => {
  before(async () => {
    Object.assign(document, {
      getElementById: () => ({
        textContent: JSON.stringify({
          apiURL: 'http://api',
          defaultLanguage: 'en',
          messageGroups: [],
        }),
      }),
    });
    mock.method(globalThis, 'fetch', async (url: string) => {
      if (!url.endsWith('/dashboard')) return new Response(JSON.stringify(ADMIN));
      const blocks = [{ name: 'Hero', label: 'Hero', fields: [TITLE] }];
      return new Response(JSON.stringify({ collections: [], locales: [], menu: [], blocks }));
    });
    sessionUser();
    await fetched();
    dashboardMeta();
    await fetched();
  });

  it('reads an empty required field in a new block quietly, and routes it back through `setErrors`', () => {
    effectScope().run(() => {
      const form = createFieldForm(
        [SECTIONS],
        { sections: [{ block: 'Hero', UUID: 'b1', fields: {} }] },
        { mode: 'edit', path: '', language: () => 'en' },
      );
      const reading = form.read();
      deepStrictEqual(structuredClone(reading), {
        errors: { 'sections[0].fields.title': 'validation.required' },
      });
      deepStrictEqual(form.snapshot(), {});
      deepStrictEqual(form.draft(), { sections: [{ block: 'Hero', UUID: 'b1', fields: {} }] });
      strictEqual(form.errored(), false);
      strictEqual(form.setErrors(reading.errors ?? {}), '');
      strictEqual(form.controlOf('sections')?.errored?.(), true);
      strictEqual(form.setErrors({}), '');
      strictEqual(form.errored(), false);
    });
  });

  it('drafts a kept block with its `UUID` and typed fields, and nothing while pristine over none', () => {
    effectScope().run(() => {
      const form = createFieldForm(
        [SECTIONS],
        { sections: [{ block: 'Hero', UUID: 'b1', fields: { title: 'Fall' } }] },
        { mode: 'edit', path: '', language: () => 'en' },
      );
      const element = h('div', null, form.render());
      type(inputOf(element), 'Wrath');
      deepStrictEqual(form.controlOf('sections')?.draft?.(), [
        { block: 'Hero', UUID: 'b1', fields: { title: 'Wrath' } },
      ]);
      const fresh = createFieldForm([SECTIONS], undefined, {
        mode: 'create',
        path: '',
        language: () => 'en',
      });
      strictEqual(fresh.controlOf('sections')?.draft?.(), undefined);
    });
  });

  it('restores blocks in place by `UUID`, keeping their forms, and a fresh one by the `$key` it drafts', () => {
    effectScope().run(() => {
      const stored = { sections: [{ block: 'Hero', UUID: 'b1', fields: { title: 'Fall' } }] };
      const form = createFieldForm([SECTIONS], stored, {
        mode: 'edit',
        path: '',
        language: () => 'en',
      });
      const element = h('div', null, form.render());
      const control = form.controlOf('sections')!;
      const input = inputOf(element) as FakeElement & { value: string };
      control.restore?.([
        { block: 'Hero', UUID: 'b1', fields: { title: 'Rise' } },
        { block: 'Hero', fields: { title: 'Wrath' } },
      ]);
      flush();
      strictEqual(inputOf(element), input);
      strictEqual(input.value, 'Rise');
      deepStrictEqual(shownInputs(element), ['Rise', 'Wrath']);
      strictEqual(control.dirty(), true);
      const [kept, fresh] = (control.draft?.() ?? []) as Item[];
      ok(isNumber(fresh?.$key));
      deepStrictEqual(kept, { block: 'Hero', UUID: 'b1', fields: { title: 'Rise' } });
      deepStrictEqual(fresh, { block: 'Hero', $key: fresh?.$key, fields: { title: 'Wrath' } });
      const [, wrath] = inputsOf(element);
      control.restore?.([kept, { ...fresh, fields: { title: 'Wrath of the Lich King' } }]);
      flush();
      strictEqual(inputsOf(element)[1], wrath);
      deepStrictEqual(shownInputs(element), ['Rise', 'Wrath of the Lich King']);
      control.restore?.(stored.sections);
      flush();
      deepStrictEqual(shownInputs(element), ['Fall']);
      strictEqual(inputOf(element), input);
      strictEqual(control.dirty(), false);
    });
  });

  it('carries each collapsed block into a rebuilt form, by `UUID` and else by the `$key` its draft carries', () => {
    effectScope().run(() => {
      const stored = {
        sections: [
          { block: 'Hero', UUID: 'b1', fields: { title: 'Fall' } },
          { block: 'Hero', fields: { title: 'Rise' } },
        ],
      };
      const options = { mode: 'edit', path: '', language: () => 'en' } as const;
      const form = createFieldForm([SECTIONS], stored, options);
      const element = h('div', null, form.render());
      toggleCard(element, 0);
      deepStrictEqual(shownInputs(element), ['Rise']);
      const drafted = form.draft();
      const [, rise] = drafted.sections as Item[];
      const folds = form.folds();
      deepStrictEqual(folds, {
        children: {
          sections: {
            children: {
              b1: { children: {}, collapsed: true },
              [String(rise?.$key)]: { children: {}, collapsed: false },
            },
          },
        },
      });
      form.dispose();
      const rebuilt = createFieldForm([SECTIONS], drafted, { ...options, folds });
      deepStrictEqual(shownInputs(h('div', null, rebuilt.render())), ['Rise']);
      deepStrictEqual(rebuilt.draft(), drafted);
    });
  });

  it('hands focus to the next block after Delete, else the previous, else the Add block button', async () => {
    await effectScope().run(async () => {
      const stored = {
        sections: [
          { block: 'Hero', UUID: 'b1', fields: { title: 'Fall' } },
          { block: 'Hero', UUID: 'b2', fields: { title: 'Rise' } },
        ],
      };
      const form = createFieldForm([SECTIONS], stored, {
        mode: 'edit',
        path: '',
        language: () => 'en',
      });
      const element = h('div', null, form.render());
      flush();
      const [, rise] = inputsOf(element);
      await pick(element, 1, 'dashboard.sort.addAfter');
      deepStrictEqual(shownInputs(element), ['Fall', 'Rise', '']);
      strictEqual(document.activeElement, inputsOf(element)[2]);
      await pick(element, 2, 'dashboard.delete');
      strictEqual(document.activeElement, rise);
      await pick(element, 0, 'dashboard.delete');
      strictEqual(document.activeElement, rise);
      await pick(element, 0, 'dashboard.delete');
      strictEqual(document.activeElement, buttonLabelled(element, 'dashboard.addBlock'));
    });
  });

  it('brings a removed block back on undo with its own controls and its fold', () => {
    effectScope().run(() => {
      const stored = {
        sections: [
          { block: 'Hero', UUID: 'b1', fields: { title: 'Fall' } },
          { block: 'Hero', fields: { title: 'Rise' } },
        ],
      };
      const form = createFieldForm([SECTIONS], stored, {
        mode: 'edit',
        path: '',
        language: () => 'en',
      });
      const element = h('div', null, form.render());
      const control = form.controlOf('sections')!;
      const [fall, rise] = inputsOf(element);
      const drafted = control.draft?.();
      toggleCard(element, 0);
      control.restore?.([]);
      flush();
      deepStrictEqual(shownInputs(element), []);
      control.restore?.(drafted);
      flush();
      deepStrictEqual(shownInputs(element), ['Rise']);
      strictEqual(inputsOf(element)[0], rise);
      toggleCard(element, 0);
      strictEqual(inputsOf(element)[0], fall);
    });
  });

  it('puts focus back on the control the user was in when an undo brings a deleted block back', async () => {
    await effectScope().run(async () => {
      const stored = {
        sections: [
          { block: 'Hero', UUID: 'b1', fields: { title: 'Fall' } },
          { block: 'Hero', UUID: 'b2', fields: { title: 'Rise' } },
        ],
      };
      const form = createFieldForm([SECTIONS], stored, {
        mode: 'edit',
        path: '',
        language: () => 'en',
      });
      const root = mount(h('div', null, form.render()) as unknown as FakeElement);
      flush();
      const [fall, rise] = inputsOf(root);
      focusIn(bodyOf(root, 1), rise as FakeElement);
      await pick(root, 1, 'dashboard.delete');
      strictEqual(document.activeElement, fall);
      const control = form.controlOf('sections')!;
      control.restore?.(stored.sections);
      await settle();
      strictEqual(document.activeElement, rise);
      focusIn(bodyOf(root, 1), rise as FakeElement);
      control.restore?.(stored.sections.slice(0, 1));
      await settle();
      strictEqual(document.activeElement, fall);
    });
  });
});
