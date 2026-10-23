import { deepStrictEqual, strictEqual } from 'node:assert';
import { before, describe, it } from 'node:test';

import type {
  DashboardCollection,
  DashboardField,
} from '../../../../src/dashboard/runtime/meta-types.ts';

import { markDataChanged } from '../../../../src/dashboard/runtime/data-changes.ts';
import { effectScope } from '../../../../src/utils/index.ts';
import { flush } from '../../../../src/utils/reactive/_scheduler.ts';
import { FakeElement, findElement, hasClass } from '../../../dashboard/_fake-dom.ts';
import { shownInputs, toggleCard } from '../../../dashboard/fields/_cards.ts';
import { inputOf, type } from '../../../dashboard/fields/_controls.ts';
import { settle } from '../../../dashboard/router/_browser.ts';
import { fire } from '../../../dashboard/ui/_events.ts';
import { baseBrowser } from '../_browser.ts';

// `baseBrowser` blanks `querySelector`; the controls need the one `_controls.ts` installs.
const { querySelector } = FakeElement.prototype as unknown as { querySelector: unknown };

type Editor = typeof import('../../../../src/base/dashboard/components/record-editor.ts');
type Guard = typeof import('../../../../src/dashboard/router/unsaved-changes.ts');

const EMAIL: DashboardField = {
  name: 'contactEmail',
  type: 'email',
  kind: 'column',
  label: 'Contact email',
  nullable: false,
  required: true,
  unique: false,
  translatable: false,
  readable: true,
  writable: true,
  immutable: false,
  options: {},
};

// A field of a type without a `draft`, as an app's own type may be.
const OMEN: DashboardField = { ...EMAIL, name: 'omen', type: 'omen', label: 'Omen' };

const FEATURED: DashboardField = {
  ...EMAIL,
  name: 'featured',
  type: 'boolean',
  label: 'Featured',
  required: false,
  options: { display: 'switch' },
};

const SHOWCASE: DashboardCollection = {
  name: 'Showcase',
  segment: 'showcase',
  label: 'Showcase',
  translatable: false,
  singleton: false,
  duplicable: false,
  operations: {
    read: { allowed: true, public: false, scoped: false },
    create: { allowed: true, public: false, scoped: false },
    update: { allowed: true, public: false, scoped: false },
    delete: null,
  },
  fields: [EMAIL, OMEN, FEATURED],
  labelFields: ['contactEmail'],
};

const QUESTS: DashboardField = {
  ...EMAIL,
  name: 'quests',
  type: 'repeater',
  kind: 'childMany',
  label: 'Quests',
  required: false,
  subfields: [{ ...EMAIL, name: 'question', type: 'text', logicalType: 'text', required: false }],
};

const QUEST_LOG: DashboardCollection = {
  ...SHOWCASE,
  name: 'QuestLog',
  segment: 'quest-log',
  label: 'Quest log',
  fields: [EMAIL, QUESTS],
};

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

describe('useRecordEditor', () => {
  let editor!: Editor;
  let hasUnsavedChanges!: Guard['hasUnsavedChanges'];
  const requests: string[] = [];
  let stored = 'thrall@x.example';

  before(async () => {
    baseBrowser('/collections/showcase/u1');
    Object.assign(document, {
      getElementById: () => ({
        textContent: JSON.stringify({
          apiURL: 'http://api',
          defaultLanguage: 'en',
          messageGroups: ['app'],
        }),
      }),
    });
    Object.assign(FakeElement.prototype, { querySelector });
    editor = await import('../../../../src/base/dashboard/components/record-editor.ts');
    ({ hasUnsavedChanges } = await import('../../../../src/dashboard/router/unsaved-changes.ts'));
    const { registerUntypedFieldType } =
      await import('../../../../src/dashboard/fields/field-type.ts');
    const { h } = await import('../../../../src/dashboard/render/h.ts');
    // Its read fails once typed into, and it has no `draft`, so the history never sees the edit.
    registerUntypedFieldType('omen', {
      display: () => null,
      control: ({ onInput }) => {
        let typed = false;
        const input = h('input');
        input.addEventListener('input', () => {
          typed = true;
          onInput();
        });
        return {
          element: h('div', null, input),
          read: () => (typed ? { errors: { '': 'nope' } } : {}),
          setErrors: () => '',
          error: () => '',
          dirty: () => typed,
          focus() {},
          revert() {
            typed = false;
          },
          rebase() {},
        };
      },
    });
    Object.assign(globalThis, {
      fetch: async (url: string, init?: RequestInit) => {
        requests.push(`${init?.method ?? 'GET'} ${url}`);
        if (url.endsWith('/messages/app/en')) {
          return Response.json({
            'app.showcase.label': { template: 'Showcases ({n})', language: 'en' },
          });
        }
        if (url.endsWith('/dashboard')) {
          const collections = [SHOWCASE, QUEST_LOG];
          return Response.json({ collections, locales: [], menu: [], blocks: [] });
        }
        if (url.endsWith('/collections/quest-log/query')) {
          const quests = [{ UUID: 'q1', question: 'Ashes' }, { question: 'Bone' }];
          return Response.json({
            records: [{ UUID: 'u1', contactEmail: 'thrall@x.example', quests }],
          });
        }
        if (url.endsWith('/collections/showcase/query')) {
          return Response.json({ records: [{ UUID: 'u1', contactEmail: stored }] });
        }
        return Response.json(ADMIN);
      },
    });
  });

  /**
   * The editor over the record `u1`, loaded and ready, inside its own scope.
   */
  async function open(collection = SHOWCASE): Promise<{
    record: ReturnType<Editor['useRecordEditor']>;
    scope: { dispose(): void };
  }> {
    const scope = effectScope();
    const record = scope.run(() => editor.useRecordEditor(collection, 'u1'));
    await settle();
    strictEqual(record.state.value, 'ready');
    strictEqual(record.dirty(), false);
    return { record, scope };
  }

  it('heads the page with the collection label translated, a message object included', async () => {
    const { loadLanguage } = await import('../../../../src/dashboard/runtime/messages.ts');
    await loadLanguage('en');
    const label = { key: 'app.showcase.label', params: { n: 1 } };
    const { record, scope } = await open({ ...SHOWCASE, label });
    const view = effectScope();
    const [, heading] = view.run(() =>
      editor.recordEditorHeading(record),
    ) as unknown as FakeElement[];
    flush();
    strictEqual(heading?.textContent, 'Showcases (1)');
    view.dispose();
    scope.dispose();
  });

  it('guards leaving on form dirt the history cannot see, and lands a draft it can', async () => {
    const { record, scope } = await open();
    const form = record.form.value!;
    type(inputOf(form.controlOf('omen')!.element), 'x');
    record.history.flush();
    strictEqual(record.history.isDirty.value, false);
    strictEqual(record.dirty(), true);
    strictEqual(hasUnsavedChanges(), true);
    type(inputOf(form.controlOf('contactEmail')!.element), 'bob@');
    record.history.flush();
    strictEqual(record.history.isDirty.value, true);
    deepStrictEqual(record.history.getCurrentState(), { contactEmail: 'bob@' });
    scope.dispose();
    strictEqual(hasUnsavedChanges(), false);
  });

  it('reloads a clean record in place once the data changed', async () => {
    const { record, scope } = await open();
    const control = record.form.value!.controlOf('contactEmail')!;
    stored = 'jaina@x.example';
    markDataChanged();
    await settle();
    strictEqual(record.form.value!.controlOf('contactEmail'), control);
    deepStrictEqual(record.history.getCurrentState(), { contactEmail: 'jaina@x.example' });
    strictEqual(record.dirty(), false);
    strictEqual(record.history.canUndo.value, false);
    stored = 'thrall@x.example';
    scope.dispose();
  });

  it('keeps a draft with unsaved edits once the data changed', async () => {
    const { record, scope } = await open();
    const control = record.form.value!.controlOf('contactEmail')!;
    type(inputOf(control.element), 'bob@x.example');
    record.history.flush();
    const sent = requests.length;
    markDataChanged();
    await settle();
    strictEqual(requests.length, sent);
    deepStrictEqual(record.history.getCurrentState(), { contactEmail: 'bob@x.example' });
    scope.dispose();
  });

  it('settles a save whose draft writes the stored value, without a request', async () => {
    const { record, scope } = await open();
    const control = record.form.value!.controlOf('contactEmail')!;
    type(inputOf(control.element), 'Thrall@X.example');
    record.history.flush();
    strictEqual(record.dirty(), true);
    const sent = requests.length;
    await record.save();
    strictEqual(requests.length, sent);
    strictEqual(record.dirty(), false);
    strictEqual(record.history.isDirty.value, false);
    deepStrictEqual(record.history.getCurrentState(), { contactEmail: 'Thrall@X.example' });
    scope.dispose();
  });

  it('keeps the items the user collapsed collapsed through an undo and a redo', async () => {
    const { record, scope } = await open(QUEST_LOG);
    const cards = (): unknown => record.form.value!.controlOf('quests')!.element;
    toggleCard(cards(), 0);
    deepStrictEqual(shownInputs(cards()), ['Bone']);
    type(inputOf(record.form.value!.controlOf('contactEmail')!.element), 'bob@x.example');
    record.history.flush();
    const typed = record.form.value;
    record.restore(record.history.undo()!);
    strictEqual(record.form.value, typed);
    deepStrictEqual(shownInputs(cards()), ['Bone']);
    record.restore(record.history.redo()!);
    deepStrictEqual(shownInputs(cards()), ['Bone']);
    scope.dispose();
  });

  it('patches the form in place on undo and redo, keeping every control and its nodes', async () => {
    const { record, scope } = await open(QUEST_LOG);
    const form = record.form.value!;
    const email = form.controlOf('contactEmail')!;
    const input = inputOf(email.element) as FakeElement & { value: string };
    const cards = form.controlOf('quests')!.element;
    const question = inputOf(cards) as FakeElement & { value: string };
    type(input, 'bob@x.example');
    record.history.flush();
    record.restore(record.history.undo()!);
    flush();
    strictEqual(record.form.value, form);
    strictEqual(form.controlOf('contactEmail'), email);
    strictEqual(inputOf(email.element), input);
    strictEqual(input.value, 'thrall@x.example');
    strictEqual(inputOf(form.controlOf('quests')!.element), question);
    strictEqual(record.dirty(), false);
    record.restore(record.history.redo()!);
    flush();
    strictEqual(inputOf(email.element), input);
    strictEqual(input.value, 'bob@x.example');
    strictEqual(record.dirty(), true);
    scope.dispose();
  });

  it('lands a discrete change as its own step at once, after the typing still pending', async () => {
    const { record, scope } = await open();
    const form = record.form.value!;
    const knob = findElement(
      form.controlOf('featured')!.element as unknown as FakeElement,
      (element) => hasClass(element, 'ohne-switch-control'),
    ) as FakeElement & { checked: boolean };
    type(inputOf(form.controlOf('contactEmail')!.element), 'bob@x.example');
    strictEqual(record.history.size.value, 1);
    knob.checked = true;
    fire(knob, 'change');
    flush();
    strictEqual(record.history.size.value, 3);
    knob.checked = false;
    fire(knob, 'change');
    flush();
    strictEqual(record.history.size.value, 4);
    deepStrictEqual(record.history.getCurrentState(), {
      contactEmail: 'bob@x.example',
      featured: false,
    });
    scope.dispose();
  });

  it('restores an invalid draft dirty against the stored value, so a save shows its check', async () => {
    const { record, scope } = await open();
    const control = record.form.value!.controlOf('contactEmail')!;
    type(inputOf(control.element), 'bob@');
    record.history.flush();
    type(inputOf(control.element), 'bob@x');
    record.history.flush();
    record.restore(record.history.undo()!);
    strictEqual(control.draft?.(), 'bob@');
    strictEqual(control.dirty(), true);
    const sent = requests.length;
    await record.save();
    strictEqual(requests.length, sent);
    strictEqual(control.error(), 'validation.invalidEmail');
    scope.dispose();
  });
});
