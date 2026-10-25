import { deepStrictEqual, strictEqual } from 'node:assert';
import { afterEach, before, beforeEach, describe, it } from 'node:test';

import type { BookmarkList } from '../../../../src/base/bookmarks/types.ts';
import type {
  DashboardCollection,
  DashboardMeta,
} from '../../../../src/dashboard/runtime/meta-types.ts';
import type { Sent } from './_popups.ts';

import { h } from '../../../../src/dashboard/render/h.ts';
import { startSession } from '../../../../src/dashboard/runtime/_request.ts';
import { dashboardMeta, invalidateDashboardMeta } from '../../../../src/dashboard/runtime/meta.ts';
import { effectScope } from '../../../../src/utils/reactive/effect-scope.ts';
import { type FakeElement, hasClass } from '../../../dashboard/_fake-dom.ts';
import { shapeOfDOM } from '../../../dashboard/ui/_menu-shape.ts';
import { baseBrowser } from '../_browser.ts';
import {
  body,
  findAll,
  fire,
  idle,
  lastInput,
  metaWith,
  recordFetch,
  recordListeners,
  textButton,
} from './_popups.ts';

const POSTS: DashboardCollection = {
  name: 'Posts',
  segment: 'posts',
  label: 'Posts',
  translatable: false,
  singleton: false,
  duplicable: false,
  operations: {
    read: { allowed: true, public: false, scoped: false },
    create: null,
    update: null,
    delete: null,
  },
  fields: [],
  labelFields: [],
};

const ROUTES = [
  'GET /dashboard/bookmarks/[collection]',
  'POST /dashboard/bookmarks/[collection]',
  'PATCH /dashboard/bookmarks/[collection]/[uuid]',
  'DELETE /dashboard/bookmarks/[collection]/[uuid]',
  'PUT /dashboard/bookmarks/[collection]/default',
];

const LIST: BookmarkList = {
  bookmarks: [
    { UUID: 'b-drafts', name: 'Drafts', view: 'where={status:draft}', shared: false, mine: true },
    { UUID: 'b-titles', name: 'Titles', view: 'order=[title]', shared: true, mine: true },
    { UUID: 'b-team', name: 'Team', view: 'order=[-title]', shared: true, mine: false },
  ],
  default: 'b-team',
};

/**
 * The bookmark row whose text holds `name`; without catalogs the declared row reads as its key.
 */
function rowOf(name: string): FakeElement {
  return findAll(
    body(),
    (element) => hasClass(element, 'ohne-card') && element.textContent.includes(name),
  ).at(-1)!;
}

/**
 * The buttons under `root` an icon-only label names; without catalogs a label reads as its key.
 */
function labelled(root: FakeElement, label: string): FakeElement[] {
  return findAll(root, (element) => element.getAttribute('aria-label') === label);
}

/**
 * Whether the button is drawn as marked.
 */
function marked(button: FakeElement): boolean {
  return button.classList.has('ohne-button-accent');
}

/**
 * Lets a popup's close transition finish.
 */
async function closed(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 350));
  await idle();
}

describe('bookmarksPopup', () => {
  let bookmarksPopup!: typeof import('../../../../src/base/dashboard/components/bookmarks-popup.ts').bookmarksPopup;
  let dialogHost!: () => unknown;
  let outlet!: FakeElement;
  let meta = metaWith(ROUTES, ['dashboard.bookmarks.share']);
  let list: BookmarkList = LIST;
  let scope: ReturnType<typeof effectScope> | undefined;
  const sent: Sent[] = [];
  const applied: string[] = [];
  let closes = 0;

  /**
   * Opens the popup over a table showing `view`, with the dialog host, and lets the list load.
   */
  const open = async (view = 'order=[title]'): Promise<void> => {
    scope = effectScope();
    scope.run(() => {
      h('div', null, dialogHost() as Node);
      bookmarksPopup({
        collection: POSTS,
        view,
        onApply: (next) => applied.push(next),
        onClose: () => {
          closes += 1;
        },
      });
    });
    await idle();
  };

  /**
   * Loads `next` as the discovery data the popup gates on.
   */
  const serve = async (next: DashboardMeta): Promise<void> => {
    meta = next;
    invalidateDashboardMeta();
    dashboardMeta();
    await idle();
  };

  /**
   * Picks the menu row labelled `label` from the row's actions menu.
   */
  const pick = (name: string, label: string): void => {
    fire(labelled(rowOf(name), 'dashboard.record.moreActions')[0]!, 'click');
    const menu = findAll(body(), (element) => element.getAttribute('role') === 'menu').at(-1)!;
    const item = findAll(
      menu,
      (element) => element.getAttribute('role') === 'menuitem' && element.textContent === label,
    )[0]!;
    fire(item, 'click');
  };

  /**
   * The shape of the row's actions menu, read by opening it, or `''` without a kebab.
   */
  const actionsOf = (name: string): string => {
    const trigger = labelled(rowOf(name), 'dashboard.record.moreActions')[0];
    if (trigger === undefined) return '';
    fire(trigger, 'click');
    const menu = findAll(body(), (element) => element.getAttribute('role') === 'menu').at(-1)!;
    const shape = shapeOfDOM(menu);
    fire(trigger, 'click');
    return shape;
  };

  /**
   * The messages of the toasts showing; a message without a catalog reads as its key.
   */
  const toasts = (): string[] =>
    outlet.childNodes
      .flatMap((list) => list.childNodes.map((item) => item.textContent))
      .filter((text) => text !== '');

  /**
   * The writes the popup sent since the test began.
   */
  const writes = (): Sent[] => sent.filter((request) => request.method !== 'GET');

  before(async () => {
    baseBrowser('/collections/posts');
    recordListeners();
    recordFetch(sent, ({ method, path }) => {
      if (path === '/dashboard') return Response.json(meta);
      if (method === 'GET') return Response.json(list);
      return method === 'DELETE' ? new Response(null, { status: 204 }) : Response.json({});
    });
    ({ bookmarksPopup } =
      await import('../../../../src/base/dashboard/components/bookmarks-popup.ts'));
    ({ dialogHost } = await import('../../../../src/dashboard/ui/dialog.ts'));
    const { toaster } = await import('../../../../src/dashboard/ui/toaster.ts');
    outlet = toaster() as unknown as FakeElement;
    startSession();
    await serve(meta);
  });

  beforeEach(() => {
    sent.length = 0;
    applied.length = 0;
    closes = 0;
    list = LIST;
  });

  afterEach(() => {
    scope?.dispose();
    body().replaceChildren();
  });

  it('lists the declared view, your bookmarks, and the shared ones, in that order', async () => {
    await open();
    const names = findAll(body(), (element) => hasClass(element, 'ohne-card')).map(
      (card) => card.textContent,
    );
    deepStrictEqual(names, [
      'dashboard.bookmarks.defaultSettings',
      'Drafts',
      'Titles(dashboard.bookmarks.sharedNote)',
      'Team',
    ]);
  });

  it('marks every bookmark of the current view applied, and your default', async () => {
    await open('order=[title]');
    const apply = (name: string): FakeElement =>
      [
        ...labelled(rowOf(name), 'dashboard.apply'),
        ...labelled(rowOf(name), 'dashboard.bookmarks.applied'),
      ][0]!;
    const star = (name: string): FakeElement =>
      [
        ...labelled(rowOf(name), 'dashboard.bookmarks.setDefault'),
        ...labelled(rowOf(name), 'dashboard.bookmarks.isDefault'),
      ][0]!;
    deepStrictEqual(
      ['dashboard.bookmarks.defaultSettings', 'Drafts', 'Titles', 'Team'].map((name) =>
        marked(apply(name)),
      ),
      [false, false, true, false],
    );
    deepStrictEqual(
      ['dashboard.bookmarks.defaultSettings', 'Drafts', 'Titles', 'Team'].map((name) =>
        marked(star(name)),
      ),
      [false, false, false, true],
    );
  });

  it('marks the declared view applied and default when nothing else is', async () => {
    list = { ...LIST, default: null };
    await open('');
    const row = rowOf('dashboard.bookmarks.defaultSettings');
    strictEqual(marked(labelled(row, 'dashboard.bookmarks.applied')[0]!), true);
    strictEqual(marked(labelled(row, 'dashboard.bookmarks.isDefault')[0]!), true);
  });

  it("applies a bookmark's view and asks to close", async () => {
    await open();
    fire(labelled(rowOf('Team'), 'dashboard.apply')[0]!, 'click');
    deepStrictEqual(applied, ['order=[-title]']);
    strictEqual(closes, 1);
  });

  it('applies the declared view as the empty view', async () => {
    await open();
    fire(labelled(rowOf('dashboard.bookmarks.defaultSettings'), 'dashboard.apply')[0]!, 'click');
    deepStrictEqual(applied, ['']);
  });

  it('sets a default without applying it, then reloads the list', async () => {
    await open();
    fire(labelled(rowOf('Drafts'), 'dashboard.bookmarks.setDefault')[0]!, 'click');
    await idle();
    deepStrictEqual(writes(), [
      { method: 'PUT', path: '/dashboard/bookmarks/posts/default', body: { bookmark: 'b-drafts' } },
    ]);
    strictEqual(sent.at(-1)?.method, 'GET');
    strictEqual(toasts().includes('dashboard.bookmarks.opensWith'), true);
    deepStrictEqual(applied, []);
    strictEqual(closes, 0);
  });

  it('clears the default through the declared view, and never resends the current one', async () => {
    await open();
    fire(labelled(rowOf('Team'), 'dashboard.bookmarks.isDefault')[0]!, 'click');
    fire(
      labelled(rowOf('dashboard.bookmarks.defaultSettings'), 'dashboard.bookmarks.setDefault')[0]!,
      'click',
    );
    await idle();
    deepStrictEqual(writes(), [
      { method: 'PUT', path: '/dashboard/bookmarks/posts/default', body: { bookmark: null } },
    ]);
    strictEqual(toasts().includes('dashboard.bookmarks.opensWithDefaults'), true);
  });

  it('offers your own rows every action, and shared rows none', async () => {
    await open();
    strictEqual(
      actionsOf('Drafts'),
      'dashboard.bookmarks.update, dashboard.bookmarks.rename, dashboard.bookmarks.share | dashboard.delete',
    );
    strictEqual(
      actionsOf('Titles'),
      'dashboard.bookmarks.rename, dashboard.bookmarks.stopSharing | dashboard.delete',
    );
    strictEqual(actionsOf('Team'), '');
  });

  it('shares, stops sharing, and updates a bookmark to the current view', async () => {
    await open('order=[title]');
    pick('Drafts', 'dashboard.bookmarks.share');
    await idle();
    pick('Titles', 'dashboard.bookmarks.stopSharing');
    await idle();
    pick('Drafts', 'dashboard.bookmarks.update');
    await idle();
    deepStrictEqual(writes(), [
      { method: 'PATCH', path: '/dashboard/bookmarks/posts/b-drafts', body: { shared: true } },
      { method: 'PATCH', path: '/dashboard/bookmarks/posts/b-titles', body: { shared: false } },
      {
        method: 'PATCH',
        path: '/dashboard/bookmarks/posts/b-drafts',
        body: { view: 'order=[title]' },
      },
    ]);
    strictEqual(sent.filter((request) => request.method === 'GET').length, 4);
    for (const message of ['nowShared', 'noLongerShared', 'viewUpdated']) {
      strictEqual(toasts().includes(`dashboard.bookmarks.${message}`), true);
    }
  });

  it('deletes only once the confirm dialog agrees', async () => {
    await open();
    pick('Drafts', 'dashboard.delete');
    await idle();
    fire(textButton('dashboard.cancel'), 'click');
    await closed();
    deepStrictEqual(writes(), []);
    pick('Drafts', 'dashboard.delete');
    await idle();
    fire(textButton('dashboard.delete'), 'click');
    await closed();
    deepStrictEqual(writes(), [
      { method: 'DELETE', path: '/dashboard/bookmarks/posts/b-drafts', body: undefined },
    ]);
    strictEqual(toasts().includes('dashboard.bookmarks.deleted'), true);
  });

  it('saves the current view under a new name', async () => {
    await open('order=[title]');
    fire(textButton('dashboard.bookmarks.add'), 'click');
    const input = lastInput();
    strictEqual(textButton('dashboard.create').getAttribute('disabled'), '');
    input.value = '  By title  ';
    fire(input, 'input');
    fire(textButton('dashboard.create'), 'click');
    await idle();
    deepStrictEqual(writes(), [
      {
        method: 'POST',
        path: '/dashboard/bookmarks/posts',
        body: { name: 'By title', view: 'order=[title]' },
      },
    ]);
    strictEqual(sent.at(-1)?.method, 'GET');
  });

  it('renames a bookmark, sending only the name', async () => {
    await open();
    pick('Drafts', 'dashboard.bookmarks.rename');
    const input = lastInput();
    strictEqual(textButton('dashboard.bookmarks.rename').getAttribute('disabled'), '');
    input.value = 'Unpublished';
    fire(input, 'input');
    fire(textButton('dashboard.bookmarks.rename'), 'click');
    await idle();
    deepStrictEqual(writes(), [
      {
        method: 'PATCH',
        path: '/dashboard/bookmarks/posts/b-drafts',
        body: { name: 'Unpublished' },
      },
    ]);
  });

  it('keeps sharing and editing a shared row behind the share capability', async () => {
    await serve(metaWith(ROUTES, []));
    await open();
    strictEqual(
      actionsOf('Drafts'),
      'dashboard.bookmarks.update, dashboard.bookmarks.rename | dashboard.delete',
    );
    strictEqual(actionsOf('Titles'), 'dashboard.bookmarks.stopSharing | dashboard.delete');
    await serve(metaWith(ROUTES, ['dashboard.bookmarks.share']));
  });

  it('hides your section while you have no bookmarks and cannot save one', async () => {
    await serve(metaWith(['GET /dashboard/bookmarks/[collection]'], []));
    list = { bookmarks: LIST.bookmarks.filter((bookmark) => !bookmark.mine), default: null };
    await open();
    strictEqual(body().textContent.includes('dashboard.bookmarks.myBookmarks'), false);
    strictEqual(body().textContent.includes('dashboard.bookmarks.sharedBookmarks'), true);
    await serve(metaWith(ROUTES, ['dashboard.bookmarks.share']));
  });

  it('drops every action whose route the app does not serve', async () => {
    await serve(metaWith(['GET /dashboard/bookmarks/[collection]'], ['*']));
    await open();
    strictEqual(actionsOf('Drafts'), '');
    strictEqual(labelled(body(), 'dashboard.bookmarks.setDefault').length, 0);
    strictEqual(labelled(body(), 'dashboard.bookmarks.isDefault').length, 0);
    strictEqual(textButton('dashboard.bookmarks.add'), undefined);
    strictEqual(labelled(rowOf('Team'), 'dashboard.apply').length, 1);
    await serve(metaWith(ROUTES, ['dashboard.bookmarks.share']));
  });
});
