import { deepStrictEqual, strictEqual } from 'node:assert';
import { before, describe, it } from 'node:test';

import type {
  DashboardCollection,
  DashboardField,
} from '../../../../src/dashboard/runtime/meta-types.ts';
import type { FakeBrowser } from '../../../dashboard/router/_browser.ts';

import { defineDashboardPage } from '../../../../src/dashboard/router/define-dashboard-page.ts';
import { navigate, startRouter, useRoute } from '../../../../src/dashboard/router/router.ts';
import { effect, effectScope, onCleanup, untracked } from '../../../../src/utils/index.ts';
import { flush } from '../../../../src/utils/reactive/_scheduler.ts';
import { FakeElement, findElement } from '../../../dashboard/_fake-dom.ts';
import { inputOf, type } from '../../../dashboard/fields/_controls.ts';
import { pageModule, settle } from '../../../dashboard/router/_browser.ts';
import { fire } from '../../../dashboard/ui/_events.ts';
import { baseBrowser } from '../_browser.ts';
import { OMEN, registerOmen } from './_omen.ts';

// `baseBrowser` blanks `querySelector`; the controls need the one `_controls.ts` installs.
const { querySelector } = FakeElement.prototype as unknown as { querySelector: unknown };

type Popup = typeof import('../../../../src/base/dashboard/components/edit-table-field-popup.ts');

describe('the `edit` query param', () => {
  let browser!: FakeBrowser;
  let popup!: Popup;
  let builds = 0;
  const seen: string[][] = [];
  const arrivals: string[][] = [];

  before(async () => {
    browser = baseBrowser('/collections/posts?page=2');
    popup = await import('../../../../src/base/dashboard/components/edit-table-field-popup.ts');
    Object.assign(globalThis, {
      testPages: {
        posts: defineDashboardPage(() => {
          builds++;
          arrivals.push(popup.editQueryParam());
          return 'posts';
        }),
        tags: defineDashboardPage(() => {
          const route = untracked(useRoute);
          onCleanup(() => popup.setEditQueryParam(null, route));
          return 'tags';
        }),
      },
    });
    await startRouter(
      [
        { pattern: '/collections/posts', url: pageModule('posts') },
        { pattern: '/collections/tags', url: pageModule('tags') },
      ],
      new FakeElement('div') as unknown as Element,
    );
    await settle();
    effectScope().run(() => effect(() => void seen.push(popup.editQueryParam())));
  });

  it('opens over the live page, pushing history', () => {
    popup.setEditQueryParam(['title', 'abc']);
    deepStrictEqual(seen.at(-1), ['title', 'abc']);
    strictEqual(browser.pushes.at(-1), '/collections/posts?page=2&edit=[title,abc]');
    strictEqual(builds, 1);
  });

  it('closes when back drops the param, keeping the page', async () => {
    browser.popstate('/collections/posts?page=2');
    await settle();
    deepStrictEqual(seen.at(-1), []);
    strictEqual(builds, 1);
  });

  it('removes the param on `null`', () => {
    popup.setEditQueryParam(['body', 'xyz']);
    popup.setEditQueryParam(null);
    deepStrictEqual(seen.at(-1), []);
    strictEqual(browser.pushes.at(-1), '/collections/posts?page=2');
  });

  it('removes the param through a route bound before a query step', () => {
    const route = untracked(useRoute);
    popup.setEditQueryParam(['title', 'abc']);
    popup.setEditQueryParam(null, route);
    deepStrictEqual(seen.at(-1), []);
    strictEqual(browser.pushes.at(-1), '/collections/posts?page=2');
  });

  it('never writes from a page a pop tore down', async () => {
    await navigate('/collections/tags?edit=[name,tag]');
    await settle();
    const pushes = browser.pushes.length;
    browser.popstate('/collections/posts?edit=[title,xyz]');
    await settle();
    strictEqual(browser.pushes.length, pushes);
    strictEqual(location.pathname + location.search, '/collections/posts?edit=[title,xyz]');
    deepStrictEqual(arrivals.at(-1), ['title', 'xyz']);
    deepStrictEqual(seen.at(-1), ['title', 'xyz']);
  });
});

const EMAIL: DashboardField = {
  name: 'email',
  type: 'email',
  kind: 'column',
  label: 'Email',
  nullable: false,
  required: true,
  unique: true,
  translatable: false,
  readable: true,
  writable: true,
  immutable: false,
  options: {},
};

const USERS: DashboardCollection = {
  name: 'Users',
  segment: 'users',
  label: 'Users',
  translatable: false,
  singleton: false,
  duplicable: false,
  operations: {
    read: { allowed: true, public: false, scoped: false },
    create: null,
    update: { allowed: true, public: false, scoped: false },
    delete: null,
  },
  fields: [EMAIL],
  labelFields: ['email'],
};

/**
 * The runtime config for `ohne-config`, and no element under any other id, as the history looks rows up.
 */
function configOnly(id: string): { textContent: string } | null {
  if (id !== 'ohne-config') return null;
  const config = { apiURL: 'http://api', defaultLanguage: 'en', messageGroups: [] };
  return { textContent: JSON.stringify(config) };
}

/**
 * Waits out the history's debounce, as a user pausing between bursts does.
 */
const pause = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 550));

describe('editTableFieldPopup', () => {
  let popup!: Popup;
  let hasUnsavedChanges!: () => boolean;

  before(async () => {
    Object.assign(FakeElement.prototype, { querySelector });
    Object.assign(document, { getElementById: configOnly });
    Object.assign(window, { dispatchEvent: () => true });
    const classes = document.body.classList as unknown as Set<string>;
    Object.assign(classes, { remove: (name: string) => classes.delete(name) });
    popup = await import('../../../../src/base/dashboard/components/edit-table-field-popup.ts');
    await registerOmen();
    ({ hasUnsavedChanges } = await import('../../../../src/dashboard/router/unsaved-changes.ts'));
    await navigate('/collections/posts?edit=[email,u1]');
    await settle();
  });

  /**
   * The popup over `writer@example.com`, its email input, and its history buttons.
   */
  function open(field = EMAIL) {
    const scope = effectScope();
    const handle = scope.run(() =>
      popup.editTableFieldPopup({
        collection: USERS,
        field,
        uuid: 'u1',
        value: 'writer@example.com',
        onClose() {},
      }),
    );
    const root = handle.root as unknown as FakeElement;
    const input = inputOf(root) as FakeElement & { value: string };
    const step = (label: string) => () => {
      const found = findElement(root, (element) =>
        (element.getAttribute('aria-label') ?? '').startsWith(label),
      )!;
      fire(found, 'click');
      flush();
    };
    return {
      scope,
      input,
      undo: step('dashboard.history.undo'),
      redo: step('dashboard.history.redo'),
    };
  }

  it('lands an invalid address and the typed case as steps, restoring them into the same input', async () => {
    const { scope, input, undo, redo } = open();
    for (const text of ['writer@example.com.uk', 'jane', 'QQ@Example.com']) {
      type(input, text);
      await pause();
    }
    undo();
    strictEqual(inputOf(input.parentNode!.parentNode), input);
    strictEqual(input.value, 'jane');
    redo();
    strictEqual(input.value, 'QQ@Example.com');
    undo();
    undo();
    strictEqual(input.value, 'writer@example.com.uk');
    redo();
    strictEqual(input.value, 'jane');
    scope.dispose();
  });

  it('guards closing on form dirt the history cannot see', () => {
    const { scope, input } = open(OMEN);
    type(input, 'x');
    strictEqual(hasUnsavedChanges(), true);
    scope.dispose();
    strictEqual(hasUnsavedChanges(), false);
  });
});
