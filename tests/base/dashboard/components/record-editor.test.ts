import { deepStrictEqual, strictEqual } from 'node:assert';
import { before, describe, it } from 'node:test';

import type {
  DashboardCollection,
  DashboardField,
  DashboardMeta,
} from '../../../../src/dashboard/runtime/meta-types.ts';

import { startSession } from '../../../../src/dashboard/runtime/_request.ts';
import { markDataChanged } from '../../../../src/dashboard/runtime/data-changes.ts';
import { dashboardMeta, invalidateDashboardMeta } from '../../../../src/dashboard/runtime/meta.ts';
import { effectScope, isUndefined } from '../../../../src/utils/index.ts';
import { flush } from '../../../../src/utils/reactive/_scheduler.ts';
import { FakeElement, type FakeNode, findElement, hasClass } from '../../../dashboard/_fake-dom.ts';
import { shownInputs, toggleCard } from '../../../dashboard/fields/_cards.ts';
import { inputOf, type } from '../../../dashboard/fields/_controls.ts';
import { type FakeBrowser, settle } from '../../../dashboard/router/_browser.ts';
import { fire } from '../../../dashboard/ui/_events.ts';
import { shapeOfDOM } from '../../../dashboard/ui/_menu-shape.ts';
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
  // A read the next query waits on.
  let held: Promise<void> | undefined;
  let deleted: () => Promise<Response> = async () => new Response(null, { status: 204 });
  let browser!: FakeBrowser;
  let dialogHost!: () => unknown;
  let outlet!: FakeElement;
  let noted: string | Promise<string | undefined> | undefined;
  let asked: string[] = [];

  before(async () => {
    browser = baseBrowser('/collections/showcase/u1');
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
    const { registerDeleteNotice } =
      await import('../../../../src/base/dashboard/components/record-view.ts');
    registerDeleteNotice((collection, uuid) => {
      asked = [collection.name, uuid];
      return noted;
    });
    ({ hasUnsavedChanges } = await import('../../../../src/dashboard/router/unsaved-changes.ts'));
    ({ dialogHost } = await import('../../../../src/dashboard/ui/dialog.ts'));
    const { toaster } = await import('../../../../src/dashboard/ui/toaster.ts');
    outlet = toaster() as unknown as FakeElement;
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
          const record = { UUID: 'u1', contactEmail: stored };
          await held;
          return Response.json({ records: [record] });
        }
        if (init?.method === 'DELETE') return deleted();
        if (init?.method === 'PATCH' && url.endsWith('/collections/showcase/u1')) {
          const sent = JSON.parse(String(init.body)) as Record<string, unknown>;
          stored = (sent.contactEmail as string | undefined) ?? stored;
          return Response.json({ UUID: 'u1', ...sent, contactEmail: stored });
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

  /**
   * Deletes `u1` through the confirm dialog, answering the `DELETE` with `answer`.
   * Resolves with the dialog's paragraphs, the toasts showing and the history pushes, once it has closed.
   */
  async function remove(answer: () => Promise<Response>): Promise<{
    record: ReturnType<Editor['useRecordEditor']>;
    paragraphs: string[];
    toasts: string[];
    pushes: string[];
  }> {
    browser.popstate('/collections/showcase/u1');
    const { record, scope } = await open();
    const { h } = await import('../../../../src/dashboard/render/h.ts');
    const { classList } = document.body as unknown as { classList: Set<string> };
    // The dialog's overlay undims the body and announces its close.
    Object.assign(classList, { remove: (name: string) => classList.delete(name) });
    Object.assign(window, { dispatchEvent: () => true });
    const host = effectScope();
    host.run(() => h('div', null, dialogHost() as Node));
    deleted = answer;
    const pushed = browser.pushes.length;
    const removed = record.remove();
    await settle();
    const content = findElement(document.body as unknown as FakeElement, (element) =>
      hasClass(element, 'ohne-dialog-content'),
    )!;
    const paragraphs = content.childNodes.map((paragraph) => paragraph.textContent);
    fire(
      findElement(
        document.body as unknown as FakeElement,
        (element) => element.tagName === 'BUTTON' && element.textContent === 'dashboard.delete',
      )!,
      'click',
    );
    await removed;
    await new Promise((resolve) => setTimeout(resolve, 350));
    await settle();
    const toasts = outlet.childNodes
      .flatMap((list) => list.childNodes.map((item) => item.textContent))
      .filter((text) => text !== '');
    host.dispose();
    scope.dispose();
    deleted = async () => new Response(null, { status: 204 });
    return { record, paragraphs, toasts, pushes: browser.pushes.slice(pushed) };
  }

  it('asks to delete with each registered notice as its own paragraph under the question', async () => {
    noted = 'It is pinned.';
    const { paragraphs } = await remove(async () => new Response(null, { status: 204 }));
    noted = undefined;
    deepStrictEqual(
      [paragraphs, asked],
      [
        ['dashboard.record.confirmDelete', 'It is pinned.'],
        ['Showcase', 'u1'],
      ],
    );
  });

  it('asks to delete with a notice that answers once its read lands', async () => {
    noted = Promise.resolve('It is pinned elsewhere.');
    const { paragraphs } = await remove(async () => new Response(null, { status: 204 }));
    noted = undefined;
    deepStrictEqual(paragraphs, ['dashboard.record.confirmDelete', 'It is pinned elsewhere.']);
  });

  it('asks to delete with only the question when no notice concerns the record', async () => {
    const { paragraphs } = await remove(async () => new Response(null, { status: 204 }));
    deepStrictEqual(paragraphs, ['dashboard.record.confirmDelete']);
  });

  it('toasts the message of a refused delete and stays on the record', async () => {
    const refused = { statusCode: 403, message: 'Only admins delete pages' };
    const { record, toasts, pushes } = await remove(async () =>
      Response.json(refused, { status: 403 }),
    );
    deepStrictEqual([toasts.includes('Only admins delete pages'), pushes], [true, []]);
    strictEqual(record.busy.value, false);
  });

  it('toasts an unreachable server when the delete never answers', async () => {
    const { record, toasts, pushes } = await remove(async () => {
      throw new TypeError('Failed to fetch');
    });
    deepStrictEqual([toasts.includes('dashboard.unreachable'), pushes], [true, []]);
    strictEqual(record.busy.value, false);
  });

  it('lands on the list after a delete', async () => {
    const { pushes } = await remove(async () => new Response(null, { status: 204 }));
    deepStrictEqual(pushes, ['/collections/showcase']);
  });

  it('leaves a record the delete cannot find for the list, with no error toast', async () => {
    const { toasts, pushes } = await remove(async () =>
      Response.json({ statusCode: 404, message: 'Not found' }, { status: 404 }),
    );
    deepStrictEqual([pushes, toasts.includes('Not found')], [['/collections/showcase'], false]);
  });

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

  /**
   * The editor over `u1` with `bob@x.example` typed, after the stored address changed under it.
   */
  async function changedUnderDraft(): Promise<{
    record: ReturnType<Editor['useRecordEditor']>;
    scope: { dispose(): void };
  }> {
    const opened = await open();
    type(inputOf(opened.record.form.value!.controlOf('contactEmail')!.element), 'bob@x.example');
    opened.record.history.flush();
    stored = 'jaina@x.example';
    markDataChanged();
    await settle();
    stored = 'thrall@x.example';
    return opened;
  }

  it('holds a newer record back under unsaved edits and names the fields it changed', async () => {
    const { record, scope } = await changedUnderDraft();
    deepStrictEqual(record.changedElsewhere(), ['contactEmail']);
    deepStrictEqual(record.history.getCurrentState(), { contactEmail: 'bob@x.example' });
    strictEqual(record.dirty(), true);
    record.keepDraft();
    deepStrictEqual(record.changedElsewhere(), []);
    deepStrictEqual(record.history.getCurrentState(), { contactEmail: 'bob@x.example' });
    scope.dispose();
  });

  it('drops the draft for the held record on `takeChanges`', async () => {
    const { record, scope } = await changedUnderDraft();
    record.takeChanges();
    flush();
    deepStrictEqual(record.history.getCurrentState(), { contactEmail: 'jaina@x.example' });
    deepStrictEqual(record.changedElsewhere(), []);
    strictEqual(record.dirty(), false);
    strictEqual(record.history.canUndo.value, false);
    scope.dispose();
  });

  it('takes the held record once an undo leaves the draft clean', async () => {
    const { record, scope } = await changedUnderDraft();
    record.restore(record.history.undo()!);
    flush();
    deepStrictEqual(record.history.getCurrentState(), { contactEmail: 'jaina@x.example' });
    deepStrictEqual(record.changedElsewhere(), []);
    strictEqual(record.dirty(), false);
    scope.dispose();
  });

  it('lands the record a save answers, after keeping the draft over changes from elsewhere', async () => {
    const { record, scope } = await open();
    const knob = findElement(
      record.form.value!.controlOf('featured')!.element as unknown as FakeElement,
      (element) => hasClass(element, 'ohne-switch-control'),
    ) as FakeElement & { checked: boolean };
    knob.checked = true;
    fire(knob, 'change');
    flush();
    stored = 'jaina@x.example';
    markDataChanged();
    await settle();
    deepStrictEqual(record.changedElsewhere(), ['contactEmail']);
    record.keepDraft();
    await record.save();
    flush();
    deepStrictEqual(record.history.getCurrentState(), {
      contactEmail: 'jaina@x.example',
      featured: true,
    });
    deepStrictEqual([record.dirty(), hasUnsavedChanges()], [false, false]);
    stored = 'thrall@x.example';
    scope.dispose();
  });

  it('drops a read sent before a save and answered after it', async () => {
    const { record, scope } = await open();
    type(inputOf(record.form.value!.controlOf('contactEmail')!.element), 'bob@x.example');
    record.history.flush();
    let answer!: () => void;
    held = new Promise((resolve) => (answer = resolve));
    markDataChanged();
    await settle();
    held = undefined;
    await record.save();
    answer();
    await settle();
    deepStrictEqual(record.history.getCurrentState(), { contactEmail: 'bob@x.example' });
    deepStrictEqual([record.dirty(), record.changedElsewhere()], [false, []]);
    stored = 'thrall@x.example';
    scope.dispose();
  });

  it('lands only the newer of two overlapping reloads', async () => {
    const { record, scope } = await open();
    let answer!: () => void;
    held = new Promise((resolve) => (answer = resolve));
    stored = 'jaina@x.example';
    markDataChanged();
    await settle();
    held = undefined;
    stored = 'sylvanas@x.example';
    markDataChanged();
    await settle();
    answer();
    await settle();
    deepStrictEqual(record.history.getCurrentState(), { contactEmail: 'sylvanas@x.example' });
    stored = 'thrall@x.example';
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

describe('recordEditorFooter menu', () => {
  const allowed = { allowed: true, public: false, scoped: false };
  const META: DashboardMeta = {
    menu: [],
    collections: [],
    blocks: [],
    roles: [],
    capabilities: [],
    routes: ['POST /collections/[collection]/[uuid]/duplicate'],
    locales: ['en', 'de'],
    defaultLocale: 'en',
    languages: ['en'],
    accountFields: [],
    accountLayout: [],
    defaultViews: {},
  };
  type Right = 'create' | 'duplicable' | 'update' | 'delete' | 'translatable';
  let editor!: Editor;
  let h!: typeof import('../../../../src/dashboard/render/h.ts').h;
  let icon!: typeof import('../../../../src/dashboard/ui/icon.ts').icon;
  let scope: ReturnType<typeof effectScope> | undefined;

  const findAll = (root: FakeNode, match: (element: FakeElement) => boolean): FakeElement[] =>
    root.childNodes.flatMap((child) => [
      ...(child instanceof FakeElement && match(child) ? [child] : []),
      ...findAll(child, match),
    ]);
  const lastMenu = (): FakeElement =>
    findAll(
      document.body as unknown as FakeElement,
      (element) => element.getAttribute('role') === 'menu',
    ).at(-1)!;
  const kebabOf = (root: FakeElement): FakeElement | undefined =>
    findAll(
      root,
      (element) => element.getAttribute('aria-label') === 'dashboard.record.moreActions',
    )[0];

  /**
   * The footer of the guild record `u1` with `rights` granted, mounted once the record and its verdicts land.
   */
  const footer = async (rights: readonly Right[]): Promise<FakeElement> => {
    scope?.dispose();
    scope = effectScope();
    const grant = (right: Right) => (rights.includes(right) ? allowed : null);
    const collection: DashboardCollection = {
      ...SHOWCASE,
      name: 'Guild',
      segment: 'guild',
      translatable: rights.includes('translatable'),
      duplicable: rights.includes('duplicable'),
      operations: {
        read: allowed,
        create: grant('create'),
        update: grant('update'),
        delete: grant('delete'),
      },
      fields: [EMAIL],
    };
    const record = scope.run(() => editor.useRecordEditor(collection, 'u1'));
    await settle();
    const root = scope.run(() => h('div', null, editor.recordEditorFooter(record) as Node));
    flush();
    return root as unknown as FakeElement;
  };

  /**
   * The shape of the footer's open record menu, `''` while it has no kebab.
   */
  const shape = (root: FakeElement): string => {
    const kebab = kebabOf(root);
    if (isUndefined(kebab)) return '';
    fire(kebab, 'click');
    flush();
    const menu = shapeOfDOM(lastMenu());
    fire(kebab, 'click');
    flush();
    return menu;
  };

  before(async () => {
    Object.assign(globalThis, {
      fetch: async (url: string) => {
        const path = new URL(url).pathname;
        if (path === '/dashboard') return Response.json(META);
        if (path === '/collections/guild/query') {
          return Response.json({ records: [{ UUID: 'u1', contactEmail: 'thrall@x.example' }] });
        }
        return new Response(null, { status: 404 });
      },
    });
    const { classList } = document.body as unknown as FakeElement;
    Object.assign(classList, {
      remove: (...names: string[]) => names.forEach((name) => classList.delete(name)),
      contains: (name: string) => classList.has(name),
    });
    editor = await import('../../../../src/base/dashboard/components/record-editor.ts');
    ({ h } = await import('../../../../src/dashboard/render/h.ts'));
    ({ icon } = await import('../../../../src/dashboard/ui/icon.ts'));
    startSession();
    invalidateDashboardMeta();
    dashboardMeta();
    await settle();
  });

  const T = 'dashboard.translations.translate';
  const cases: [string, Right[], string][] = [
    ['create', ['create'], 'dashboard.new'],
    ['create + duplicate', ['create', 'duplicable'], 'dashboard.new, dashboard.duplicate'],
    ['create + translate', ['create', 'translatable'], `${T}, dashboard.new`],
    ['translate only', ['translatable'], T],
    ['delete', ['delete'], 'dashboard.delete'],
    ['translate + delete', ['translatable', 'delete'], `${T} | dashboard.delete`],
    [
      'every right',
      ['create', 'duplicable', 'update', 'delete', 'translatable'],
      `${T}, dashboard.new, dashboard.duplicate | dashboard.delete`,
    ],
    ['update only', ['update'], ''],
    ['duplicable without create', ['update', 'duplicable'], ''],
  ];
  for (const [name, rights, expected] of cases) {
    it(`renders ${JSON.stringify(expected)} for ${name}`, async () => {
      strictEqual(shape(await footer(rights)), expected);
    });
  }

  it('renders no footer while the user may neither write, create, translate, nor delete', async () => {
    const root = await footer(['duplicable']);
    strictEqual(findAll(root, (element) => hasClass(element, 'o-record-editor-footer')).length, 0);
  });

  it('links New to the create page and marks Delete destructive with `trash-x`', async () => {
    const root = await footer(['create', 'delete']);
    fire(kebabOf(root)!, 'click');
    flush();
    const [create, remove] = findAll(
      lastMenu(),
      (element) => element.getAttribute('role') === 'menuitem',
    );
    strictEqual(create?.getAttribute('href'), '/collections/guild/new');
    const svg = findElement(remove!, (element) => element.tagName === 'SVG');
    deepStrictEqual(
      [
        hasClass(remove!, 'ohne-dropdown-item-destructive'),
        (svg as unknown as SVGSVGElement).innerHTML === icon('trash-x').innerHTML,
      ],
      [true, true],
    );
  });

  it('marks the open kebab expanded instead of turning it primary', async () => {
    const root = await footer(['delete']);
    const kebab = kebabOf(root)!;
    fire(kebab, 'click');
    flush();
    strictEqual(kebab.getAttribute('aria-expanded'), 'true');
    strictEqual(hasClass(kebab, 'ohne-button-primary'), false);
    fire(kebab, 'click');
    flush();
    strictEqual(kebab.getAttribute('aria-expanded'), 'false');
    scope?.dispose();
  });
});
