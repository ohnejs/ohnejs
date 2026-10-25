import { deepStrictEqual, strictEqual } from 'node:assert';
import { before, describe, it } from 'node:test';

import type {
  DashboardCollection,
  DashboardField,
  DashboardMeta,
} from '../../../../src/dashboard/runtime/meta-types.ts';
import type { FakeBrowser } from '../../../dashboard/router/_browser.ts';

import { h } from '../../../../src/dashboard/render/h.ts';
import { defineDashboardPage } from '../../../../src/dashboard/router/define-dashboard-page.ts';
import { startSession } from '../../../../src/dashboard/runtime/_request.ts';
import { markDataChanged } from '../../../../src/dashboard/runtime/data-changes.ts';
import { dashboardMeta, invalidateDashboardMeta } from '../../../../src/dashboard/runtime/meta.ts';
import { isUndefined } from '../../../../src/utils/is/is-undefined.ts';
import { flush } from '../../../../src/utils/reactive/_scheduler.ts';
import { effectScope } from '../../../../src/utils/reactive/effect-scope.ts';
import {
  FakeElement,
  type FakeNode,
  findElement,
  hasClass,
  resizeTo,
} from '../../../dashboard/_fake-dom.ts';
import { pageModule, settle } from '../../../dashboard/router/_browser.ts';
import { shapeOfDOM } from '../../../dashboard/ui/_menu-shape.ts';
import { baseBrowser } from '../_browser.ts';

const { navigate, startRouter } = await import('../../../../src/dashboard/router/router.ts');

type Listener = (event: unknown) => void;

const handlers = new WeakMap<object, Map<string, Listener[]>>();

/**
 * Lets the router and the tables' loads settle.
 */
async function idle(): Promise<void> {
  for (let i = 0; i < 3; i++) await settle();
}

/**
 * Records every listener an element or the window adds, so `dispatch` can run them.
 * Elements also gain the style and class list methods a menu and a popup call.
 */
function recordListeners(): void {
  const record = (target: object, type: string, listener: Listener): void => {
    const byType = handlers.get(target) ?? new Map<string, Listener[]>();
    handlers.set(target, byType);
    byType.set(type, [...(byType.get(type) ?? []), listener]);
  };
  Object.assign(FakeElement.prototype, {
    addEventListener(this: FakeElement, type: string, listener: Listener) {
      record(this, type, listener);
    },
    matches: () => false,
    querySelector(this: FakeElement, selector: string) {
      return findElement(this, (element) => element.tagName === selector.toUpperCase()) ?? null;
    },
    scrollTo() {},
    showPopover() {},
    hidePopover() {},
  });
  const create = document.createElement.bind(document);
  Object.assign(document, {
    createElement: (tag: string) => {
      const element = create(tag) as unknown as FakeElement;
      Object.assign(element.style, { removeProperty() {}, setProperty() {} });
      Object.assign(element.classList, {
        remove: (...names: string[]) => names.forEach((name) => element.classList.delete(name)),
        contains: (name: string) => element.classList.has(name),
      });
      return element;
    },
  });
  Object.assign(document, { body: document.createElement('body') });
  Object.defineProperty(FakeElement.prototype, 'textContent', {
    get(this: FakeElement): string {
      return this.childNodes.map((node) => node.textContent).join('');
    },
    set(this: FakeElement, text: string) {
      this.replaceChildren();
      if (text) this.appendChild(document.createTextNode(text) as unknown as FakeNode);
    },
  });
  const listen = window.addEventListener.bind(window);
  Object.assign(window, {
    addEventListener: (type: string, listener: Listener) => {
      record(window, type, listener);
      listen(type, listener as () => void);
    },
    getSelection: () => ({ removeAllRanges() {} }),
    dispatchEvent: () => true,
  });
}

/**
 * Runs every `type` listener `target` holds with a minimal event carrying `extra`.
 */
function dispatch(target: object, type: string, extra: Record<string, unknown> = {}): void {
  const event = {
    type,
    target,
    currentTarget: target,
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    button: 0,
    key: '',
    preventDefault() {},
    stopPropagation() {},
    ...extra,
  };
  for (const listener of handlers.get(target)?.get(type) ?? []) listener(event);
}

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

let browser!: FakeBrowser;

describe('collectionTable', () => {
  let edit!: typeof import('../../../../src/base/dashboard/components/edit-table-field-popup.ts');
  const loads: number[] = [];

  before(async () => {
    browser = baseBrowser('/collections/posts');
    recordListeners();
    Object.assign(globalThis, {
      fetch: async (url: string, init?: RequestInit) => {
        if (!url.endsWith('/collections/posts/query')) return new Response(null, { status: 404 });
        loads.push((JSON.parse(String(init?.body)) as { page: number }).page);
        return new Response(null, { status: 500 });
      },
    });
    const { collectionTable } =
      await import('../../../../src/base/dashboard/components/collection-table.ts');
    const { rememberView } =
      await import('../../../../src/base/dashboard/components/collection-table-data.ts');
    edit = await import('../../../../src/base/dashboard/components/edit-table-field-popup.ts');
    rememberView('posts', '?page=3');
    Object.assign(globalThis, {
      testPages: { posts: defineDashboardPage(() => collectionTable(POSTS)) },
    });
    await startRouter(
      ['posts', 'notes', 'tags', 'drafts'].map((segment) => ({
        pattern: `/collections/${segment}`,
        url: pageModule(segment),
      })),
      new FakeElement('div') as unknown as Element,
    );
    await idle();
  });

  it('restores the remembered view on a bare visit, loading only that view', () => {
    deepStrictEqual(browser.replaces, ['/collections/posts?page=3']);
    deepStrictEqual(loads, [3]);
  });

  it('keeps the table while the `edit` param changes', async () => {
    edit.setEditQueryParam(['title', 'abc']);
    await idle();
    edit.setEditQueryParam(null);
    await idle();
    deepStrictEqual(loads, [3]);
  });

  it('rebuilds on any other query change', async () => {
    await navigate('/collections/posts?page=4');
    await idle();
    deepStrictEqual(loads, [3, 4]);
  });

  it('restores again when the query arrives bare in place', async () => {
    await navigate('/collections/posts');
    await idle();
    strictEqual(location.search, '?page=4');
    strictEqual(browser.replaces.at(-1), '/collections/posts?page=4');
    deepStrictEqual(loads, [3, 4]);
  });

  it('lands on the bare view when back brings it', async () => {
    browser.popstate('/collections/posts');
    await idle();
    strictEqual(location.search, '');
    deepStrictEqual(loads, [3, 4, 1]);
  });
});

describe('collectionTable sheet', () => {
  const field = (name: string, label: string): DashboardField => ({
    name,
    type: 'text',
    kind: 'column',
    logicalType: 'text',
    label,
    nullable: false,
    required: false,
    unique: false,
    translatable: false,
    readable: true,
    writable: true,
    immutable: false,
  });
  const allowed = { allowed: true, public: false, scoped: false };
  const RAIDERS: DashboardCollection = {
    name: 'Raiders',
    segment: 'raiders',
    label: 'Raiders',
    translatable: false,
    singleton: false,
    duplicable: false,
    operations: { read: allowed, create: null, update: allowed, delete: allowed },
    fields: [field('name', 'Name'), field('role', 'Role')],
    labelFields: ['name'],
    table: { columns: ['name', 'role'] },
  };
  const RECORDS = [
    { UUID: 'u-thrall', name: 'Thrall', role: 'Shaman' },
    { UUID: 'u-jaina', name: 'Jaina', role: 'Mage' },
    { UUID: 'u-anduin', name: 'Anduin', role: 'Priest' },
  ];
  let records: Record<string, unknown>[] = RECORDS;
  let lastPage = 1;
  let answer: () => void = () => {};
  let scope: ReturnType<typeof effectScope> | undefined;
  let collectionTable!: (collection: DashboardCollection) => unknown;
  let dialogHost!: () => unknown;

  const findAll = (root: FakeNode, match: (element: FakeElement) => boolean): FakeElement[] =>
    root.childNodes.flatMap((child) => [
      ...(child instanceof FakeElement && match(child) ? [child] : []),
      ...findAll(child, match),
    ]);
  const byTag = (root: FakeNode, tag: string): FakeElement[] =>
    findAll(root, (element) => element.tagName === tag);
  const byClass = (root: FakeNode, name: string): FakeElement[] =>
    findAll(root, (element) => (element.getAttribute('class') ?? '').split(' ').includes(name));
  const bodyRows = (root: FakeElement): FakeElement[] => byTag(byTag(root, 'TBODY')[0]!, 'TR');
  const names = (root: FakeElement): string[] =>
    bodyRows(root).map((row) => byTag(row, 'TD')[0]!.textContent);
  const rowOf = (root: FakeElement, name: string): FakeElement =>
    bodyRows(root).find((row) => row.textContent.includes(name))!;
  const body = (): FakeElement => document.body as unknown as FakeElement;
  const selectAll = (root: FakeElement): FakeElement & { checked: boolean } =>
    byTag(byTag(root, 'THEAD')[0]!, 'INPUT')[0]! as FakeElement & { checked: boolean };
  const checked = (root: FakeElement): string[] =>
    bodyRows(root).flatMap((row) =>
      findAll(row, (element) => element.getAttribute('role') === 'checkbox').map(
        (box) => box.getAttribute('aria-checked')!,
      ),
    );

  /**
   * Clicks the checkbox of the row showing `name`, flipping it as the native input does.
   */
  const toggle = (root: FakeElement, name: string): void => {
    const input = byTag(rowOf(root, name), 'INPUT')[0]! as FakeElement & { checked: boolean };
    input.checked = !input.checked;
    dispatch(input, 'change');
    flush();
  };

  const lastMenu = (): FakeElement =>
    findAll(body(), (element) => element.getAttribute('role') === 'menu').at(-1)!;
  const menuRows = (menu: FakeElement): FakeElement[] =>
    findAll(menu, (element) => element.getAttribute('role') === 'menuitem');
  const labelOf = (row: FakeElement): string =>
    findAll(row, (element) => element.tagName === 'KBD').reduce(
      (text, hint) => text.replace(hint.textContent, ''),
      row.textContent,
    );
  const labels = (menu: FakeElement): string[] => menuRows(menu).map(labelOf);
  const menuRow = (menu: FakeElement, label: string): FakeElement =>
    menuRows(menu).find((row) => labelOf(row) === label)!;

  /**
   * Picks the menu row labelled `label` from the row's actions menu; without catalogs a label reads as its key.
   */
  const pickAction = (root: FakeElement, name: string, label: string): void => {
    dispatch(byClass(rowOf(root, name), 'ohne-table-kebab')[0]!, 'click');
    flush();
    const menu = findAll(body(), (element) => element.getAttribute('role') === 'menu').at(-1)!;
    const item = findAll(
      menu,
      (element) => element.getAttribute('role') === 'menuitem' && element.textContent === label,
    )[0]!;
    dispatch(item, 'click');
    flush();
  };

  /**
   * Mounts the raiders sheet with the dialog host, answers its first page, and lets it settle.
   */
  const sheet = async (collection = RAIDERS): Promise<FakeElement> => {
    scope?.dispose();
    scope = effectScope();
    const root = scope.run(() =>
      h('div', null, collectionTable(collection) as Node, dialogHost() as Node),
    )!;
    flush();
    answer();
    await idle();
    return root as unknown as FakeElement;
  };

  before(async () => {
    Object.assign(globalThis, {
      fetch: (url: string, init?: RequestInit) => {
        if (!String(url).endsWith('/collections/raiders/query')) {
          return Promise.resolve(new Response(null, { status: 404 }));
        }
        const { page } = JSON.parse(String(init?.body)) as { page: number };
        return new Promise<Response>((resolve) => {
          answer = () =>
            resolve(
              Response.json({
                records,
                page,
                lastPage,
                perPage: 50,
                total: records.length * lastPage,
              }),
            );
        });
      },
    });
    ({ collectionTable } =
      await import('../../../../src/base/dashboard/components/collection-table.ts'));
    ({ dialogHost } = await import('../../../../src/dashboard/ui/dialog.ts'));
  });

  it('shows skeleton rows until the page lands, then its records as served', async () => {
    scope?.dispose();
    scope = effectScope();
    const root = scope.run(() =>
      h('div', null, collectionTable(RAIDERS) as Node),
    )! as unknown as FakeElement;
    flush();
    strictEqual(byTag(root, 'TABLE')[0]!.getAttribute('aria-busy'), 'true');
    strictEqual(bodyRows(root).length, 5);
    answer();
    await idle();
    deepStrictEqual(names(root), ['Thrall', 'Jaina', 'Anduin']);
  });

  it('lays out fixed, the first column and the actions sticky', async () => {
    const root = await sheet();
    const cells = byTag(rowOf(root, 'Jaina'), 'TD');
    strictEqual(cells[0]!.getAttribute('class'), 'ohne-table-first');
    strictEqual(cells.at(-1)!.getAttribute('class'), 'ohne-table-actions');
    strictEqual(byClass(root, 'ohne-table-fixed').length, 1);
  });

  it('opens a cell editor through the `edit` param', async () => {
    const root = await sheet();
    const button = byClass(
      byTag(rowOf(root, 'Jaina'), 'TD')[1]!,
      'o-editable-field-cell-button',
    )[0]!;
    dispatch(byTag(button, 'BUTTON')[0]!, 'click');
    await idle();
    strictEqual(decodeURIComponent(location.search), '?edit=[role,u-jaina]');
    await navigate('/collections/posts');
    await idle();
  });

  it('shows the URL order on its header and pushes the next order', async () => {
    await navigate('/collections/posts?order=-name');
    await idle();
    const root = await sheet();
    const header = byTag(root, 'TH').find((cell) => cell.textContent === 'Name')!;
    strictEqual(header.getAttribute('aria-sort'), 'descending');
    deepStrictEqual(names(root), ['Thrall', 'Jaina', 'Anduin']);
    dispatch(byClass(header, 'ohne-table-sort')[0]!, 'click');
    strictEqual(location.search, '?order=[name]');
    await navigate('/collections/posts');
    await idle();
  });

  it('opens a record on a double-click', async () => {
    const root = await sheet();
    dispatch(rowOf(root, 'Anduin'), 'click');
    await idle();
    strictEqual(location.pathname, '/collections/posts');
    dispatch(rowOf(root, 'Anduin'), 'dblclick');
    await idle();
    strictEqual(location.pathname, '/collections/raiders/u-anduin');
    await navigate('/collections/posts');
    await idle();
  });

  it('selects through a row menu, which shows the checkboxes and the delete button', async () => {
    const root = await sheet();
    strictEqual(byClass(root, 'ohne-table-check').length, 0);
    pickAction(root, 'Jaina', 'dashboard.select');
    strictEqual(byClass(rowOf(root, 'Thrall'), 'ohne-table-check').length, 1);
    strictEqual(byClass(root, 'ohne-button-destructive').length, 1);
    pickAction(root, 'Jaina', 'dashboard.deselect');
    strictEqual(byClass(root, 'ohne-table-check').length, 0);
  });

  it('offers to open a row in a new tab', async () => {
    const root = await sheet();
    dispatch(byClass(rowOf(root, 'Jaina'), 'ohne-table-kebab')[0]!, 'click');
    flush();
    const link = menuRow(lastMenu(), 'dashboard.openInNewTab');
    deepStrictEqual(
      [link.tagName, link.getAttribute('href'), link.getAttribute('target')],
      ['A', '/collections/raiders/u-jaina', '_blank'],
    );
    scope?.dispose();
  });

  it('acts on the whole selection on a right-click on a row of a selection of several', async () => {
    const root = await sheet();
    pickAction(root, 'Thrall', 'dashboard.select');
    dispatch(rowOf(root, 'Thrall'), 'contextmenu', { clientX: 0, clientY: 0 });
    flush();
    strictEqual(labels(lastMenu()).includes('dashboard.deselect'), true);
    pickAction(root, 'Jaina', 'dashboard.select');
    dispatch(rowOf(root, 'Anduin'), 'contextmenu', { clientX: 0, clientY: 0 });
    flush();
    strictEqual(labels(lastMenu()).includes('dashboard.select'), true);
    dispatch(rowOf(root, 'Jaina'), 'contextmenu', { clientX: 0, clientY: 0 });
    flush();
    deepStrictEqual(labels(lastMenu()), [
      'dashboard.clearSelection',
      'dashboard.table.deleteCount',
    ]);
    const remove = menuRow(lastMenu(), 'dashboard.table.deleteCount');
    const { isMac } = await import('../../../../src/dashboard/ui/hotkeys.ts');
    strictEqual(remove.getAttribute('aria-keyshortcuts'), isMac() ? 'Backspace' : 'Delete');
    dispatch(remove, 'click');
    await idle();
    const cancel = findAll(
      body(),
      (element) => element.tagName === 'BUTTON' && element.textContent === 'dashboard.cancel',
    ).at(-1)!;
    strictEqual(
      findAll(body(), (element) => element.textContent === 'dashboard.table.confirmDeleteMany')
        .length > 0,
      true,
    );
    dispatch(cancel, 'click');
    await idle();
    deepStrictEqual(checked(root), ['true', 'true', 'false']);
    dispatch(rowOf(root, 'Thrall'), 'contextmenu', { clientX: 0, clientY: 0 });
    flush();
    dispatch(menuRow(lastMenu(), 'dashboard.clearSelection'), 'click');
    flush();
    strictEqual(byClass(root, 'ohne-table-check').length, 0);
    scope?.dispose();
  });

  it('folds New to an icon below 768px of footer, and marks the footer while rows are selected', async () => {
    const root = await sheet({
      ...RAIDERS,
      operations: { ...RAIDERS.operations, create: allowed },
    });
    const footer = byClass(root, 'o-collection-table-footer')[0]!;
    const create = (): FakeElement => byClass(footer, 'ohne-button-primary')[0]!;
    strictEqual(create().getAttribute('aria-label'), null);
    resizeTo(footer, 767);
    flush();
    strictEqual(create().getAttribute('aria-label'), 'dashboard.new');
    resizeTo(footer, 768);
    flush();
    strictEqual(create().getAttribute('aria-label'), null);
    strictEqual(hasClass(footer, 'o-collection-table-footer-has-selection'), false);
    pickAction(root, 'Jaina', 'dashboard.select');
    strictEqual(hasClass(footer, 'o-collection-table-footer-has-selection'), true);
  });

  it('ranges with Shift from the row selected alone', async () => {
    const root = await sheet();
    pickAction(root, 'Thrall', 'dashboard.select');
    dispatch(window, 'keydown', { key: 'Shift' });
    toggle(root, 'Anduin');
    dispatch(window, 'keyup', { key: 'Shift' });
    strictEqual(selectAll(root).checked, true);
    toggle(root, 'Jaina');
    strictEqual(selectAll(root).checked, false);
  });

  it('selects a lone page at once from the header box', async () => {
    const root = await sheet();
    pickAction(root, 'Thrall', 'dashboard.select');
    const box = selectAll(root);
    box.checked = true;
    dispatch(box, 'change');
    await idle();
    deepStrictEqual(checked(root), ['true', 'true', 'true']);
    strictEqual(
      findAll(body(), (element) => element.textContent === 'dashboard.table.allCount').length,
      0,
    );
  });

  it('asks page or all before selecting across pages', async () => {
    lastPage = 2;
    const root = await sheet();
    pickAction(root, 'Thrall', 'dashboard.select');
    const box = selectAll(root);
    box.checked = true;
    dispatch(box, 'change');
    await idle();
    const all = findAll(
      body(),
      (element) =>
        element.tagName === 'BUTTON' && element.textContent === 'dashboard.table.allCount',
    )[0];
    strictEqual(all !== undefined, true);
    dispatch(all!, 'click');
    await idle();
    deepStrictEqual(checked(root), ['true', 'true', 'true']);
    lastPage = 1;
  });

  it('reloads the page in place once the data changed', async () => {
    const root = await sheet();
    records = [{ ...RECORDS[0], name: "Go'el" }, ...RECORDS.slice(1)];
    markDataChanged();
    flush();
    answer();
    await idle();
    deepStrictEqual(names(root), ["Go'el", 'Jaina', 'Anduin']);
    records = RECORDS;
    scope?.dispose();
  });

  it('shows the empty state for a page without records', async () => {
    records = [];
    const root = await sheet();
    strictEqual(bodyRows(root)[0]!.textContent, 'No data available');
    records = RECORDS;
    scope?.dispose();
  });
});

describe('collectionTable refused views', () => {
  const PAGE = { records: [], page: 1, lastPage: 1, perPage: 50, total: 0 };
  const bodies: Record<string, unknown>[] = [];
  let refuse: (body: Record<string, unknown>) => string | undefined = () => undefined;
  let outlet!: FakeElement;

  /**
   * The messages of the toasts showing; without catalogs a message reads as its key.
   */
  const toasts = (): string[] =>
    outlet.childNodes
      .flatMap((list) => list.childNodes.map((item) => item.textContent))
      .filter((text) => text !== '');

  /**
   * Opens `path` and returns the query bodies its table sent while it settled.
   */
  const open = async (path: string): Promise<Record<string, unknown>[]> => {
    bodies.length = 0;
    await navigate(path);
    await idle();
    return [...bodies];
  };

  /**
   * Runs `go` while the posts collection declares `order` over a sortable `title`.
   */
  const withOrder = async <T>(order: readonly string[], go: () => Promise<T>): Promise<T> => {
    const title = { name: 'title', kind: 'column', logicalType: 'text', readable: true };
    Object.assign(POSTS, { fields: [title], table: { order } });
    try {
      return await go();
    } finally {
      Object.assign(POSTS, { fields: [], table: undefined });
    }
  };

  before(async () => {
    Object.assign(globalThis, {
      fetch: async (url: string, init?: RequestInit) => {
        if (!url.endsWith('/collections/posts/query')) return new Response(null, { status: 404 });
        const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
        bodies.push(body);
        const path = refuse(body);
        if (path === undefined) return Response.json(PAGE);
        const data = { code: 'invalidField', path };
        return Response.json({ statusCode: 400, message: 'Refused', data }, { status: 400 });
      },
    });
    const { toaster } = await import('../../../../src/dashboard/ui/toaster.ts');
    outlet = toaster() as unknown as FakeElement;
  });

  it('drops a refused filter with one toast, and reloads without it', async () => {
    refuse = (body) => (body.where === undefined ? undefined : 'where.title');
    const sent = await open('/collections/posts?where={title:x}');
    deepStrictEqual(
      sent.map((body) => body.where),
      [{ title: 'x' }, undefined],
    );
    strictEqual(location.search, '');
    strictEqual(browser.replaces.at(-1), '/collections/posts');
    deepStrictEqual(toasts(), ['dashboard.table.filterDropped']);
  });

  it('drops a refused order back to the default', async () => {
    refuse = (body) => (String(body.order) === '-_updatedAt' ? undefined : 'order[0]');
    const sent = await open('/collections/posts?order=title');
    deepStrictEqual(
      sent.map((body) => body.order),
      [['title'], ['-_updatedAt']],
    );
    strictEqual(location.search, '');
  });

  it('sorts by the declared default, keeping it out of the URL', async () => {
    refuse = () => undefined;
    const sent = await withOrder(['-title'], () => open('/collections/posts?page=2'));
    deepStrictEqual(
      sent.map((body) => body.order),
      [['-title']],
    );
    strictEqual(location.search, '?page=2');
  });

  it('heals a refused declared default to newest updated first, instead of stalling', async () => {
    refuse = (body) => (String(body.order) === '-_updatedAt' ? undefined : 'order[0]');
    const shown = toasts().length;
    const sent = await withOrder(['-title'], () => open('/collections/posts?page=3'));
    deepStrictEqual(
      sent.map((body) => body.order),
      [['-title'], ['-_updatedAt']],
    );
    strictEqual(toasts().length, shown + 1);
  });

  it('restores the declared columns once, then stops when those are refused too', async (t) => {
    t.mock.method(console, 'warn', () => {});
    refuse = () => 'select[0]';
    const shown = toasts().length;
    const sent = await open('/collections/posts?columns=[title]');
    strictEqual(sent.length, 2);
    strictEqual(location.search, '');
    strictEqual(toasts().length, shown + 1);
    strictEqual(toasts()[0], 'dashboard.table.columnsDropped');
  });

  it('leaves the grid empty when the refused part is not in the view', async () => {
    refuse = () => 'select[0]';
    const shown = toasts().length;
    const sent = await open('/collections/posts?page=2');
    strictEqual(sent.length, 1);
    strictEqual(location.search, '?page=2');
    strictEqual(toasts().length, shown);
  });
});

describe('collectionTable default views', () => {
  const PAGE = { records: [], page: 1, lastPage: 1, perPage: 50, total: 0 };
  const META: DashboardMeta = {
    menu: [],
    collections: [],
    blocks: [],
    roles: [],
    capabilities: [],
    routes: [],
    locales: ['en'],
    defaultLocale: 'en',
    languages: ['en'],
    accountFields: [],
    accountLayout: [],
    defaultViews: {
      Notes: { bookmark: 'b-notes', view: 'order=[title]' },
      Tags: { bookmark: 'b-tags', view: '' },
      Drafts: { bookmark: 'b-drafts', view: 'order=[title]' },
    },
  };
  const orders: unknown[] = [];

  /**
   * Runs the navigation `go` and returns the orders the table loaded while it settled.
   */
  const visit = async (go: () => unknown): Promise<unknown[]> => {
    orders.length = 0;
    await go();
    await idle();
    return [...orders];
  };

  before(async () => {
    Object.assign(globalThis, {
      fetch: async (url: string, init?: RequestInit) => {
        if (url.endsWith('/dashboard')) return Response.json(META);
        if (!url.endsWith('/query')) return new Response(null, { status: 404 });
        orders.push((JSON.parse(String(init?.body)) as { order: unknown }).order);
        return Response.json(PAGE);
      },
    });
    const { collectionTable } =
      await import('../../../../src/base/dashboard/components/collection-table.ts');
    const page = (name: string) =>
      defineDashboardPage(() =>
        collectionTable({ ...POSTS, name, label: name, segment: name.toLowerCase() }),
      );
    Object.assign((globalThis as unknown as { testPages: object }).testPages, {
      notes: page('Notes'),
      tags: page('Tags'),
      drafts: page('Drafts'),
    });
    startSession();
    dashboardMeta();
    await idle();
  });

  it('opens a bare first visit on the default view, loading only that view', async () => {
    const loaded = await visit(() => navigate('/collections/notes'));
    strictEqual(browser.replaces.at(-1), '/collections/notes?order=[title]');
    deepStrictEqual(loaded, [['title']]);
  });

  it('stays bare when the default is the declared view, leaving no `?`', async () => {
    const replaced = browser.replaces.length;
    const loaded = await visit(() => navigate('/collections/tags'));
    strictEqual(browser.replaces.length, replaced);
    strictEqual(location.href, 'http://dashboard/collections/tags');
    deepStrictEqual(loaded, [['-_updatedAt']]);
  });

  it('lands bare when back brings the bare URL, despite a default', async () => {
    const loaded = await visit(() => browser.popstate('/collections/drafts'));
    strictEqual(location.search, '');
    deepStrictEqual(loaded, [['-_updatedAt']]);
  });

  it('keeps a remembered declared view over the default', async () => {
    await navigate('/collections/notes');
    await idle();
    const loaded = await visit(() => navigate('/collections/drafts'));
    strictEqual(location.search, '');
    deepStrictEqual(loaded, [['-_updatedAt']]);
  });
});

describe('collectionTable bookmarks', () => {
  const PAGE = { records: [], page: 1, lastPage: 1, perPage: 50, total: 0 };
  const META: Omit<DashboardMeta, 'routes'> = {
    menu: [],
    collections: [],
    blocks: [],
    roles: [],
    capabilities: [],
    locales: ['en'],
    defaultLocale: 'en',
    languages: ['en'],
    accountFields: [],
    accountLayout: [],
    defaultViews: {},
  };
  const LIST = {
    bookmarks: [
      { UUID: 'b-titles', name: 'Titles', view: 'order=[title]', shared: false, mine: true },
      { UUID: 'b-team', name: 'Team', view: 'order=[-title]', shared: true, mine: false },
    ],
    default: null,
  };
  let routes: string[] = [];
  let scope: ReturnType<typeof effectScope> | undefined;
  let collectionTable!: (collection: DashboardCollection) => unknown;

  const findAll = (root: FakeNode, match: (element: FakeElement) => boolean): FakeElement[] =>
    root.childNodes.flatMap((child) => [
      ...(child instanceof FakeElement && match(child) ? [child] : []),
      ...findAll(child, match),
    ]);
  const labelled = (root: FakeNode, label: string): FakeElement[] =>
    findAll(root, (element) => element.getAttribute('aria-label') === label);
  const body = (): FakeElement => document.body as unknown as FakeElement;

  /**
   * Serves `next` as the app's routes, then mounts the posts table and lets it settle.
   */
  const mount = async (next: string[]): Promise<FakeElement> => {
    routes = next;
    invalidateDashboardMeta();
    dashboardMeta();
    await idle();
    scope?.dispose();
    scope = effectScope();
    const root = scope.run(() => h('div', null, collectionTable(POSTS) as Node))!;
    await idle();
    return root as unknown as FakeElement;
  };

  before(async () => {
    Object.assign(globalThis, {
      fetch: async (url: string) => {
        const path = new URL(url).pathname;
        if (path === '/dashboard') return Response.json({ ...META, routes });
        if (path === '/dashboard/bookmarks/posts') return Response.json(LIST);
        if (path.endsWith('/query')) return Response.json(PAGE);
        return new Response(null, { status: 404 });
      },
    });
    ({ collectionTable } =
      await import('../../../../src/base/dashboard/components/collection-table.ts'));
  });

  it('shows no bookmarks button while the app does not serve the list route', async () => {
    const root = await mount(['POST /dashboard/bookmarks/[collection]']);
    strictEqual(labelled(root, 'dashboard.bookmarks.title').length, 0);
    scope?.dispose();
  });

  it('opens on the current view, without page or foreign params, and applies a pick', async () => {
    await navigate('/collections/posts?page=3&order=[title]&utm=x');
    await idle();
    const root = await mount(['GET /dashboard/bookmarks/[collection]']);
    dispatch(labelled(root, 'dashboard.bookmarks.title')[0]!, 'click');
    await idle();
    const row = (name: string): FakeElement =>
      findAll(
        body(),
        (element) => hasClass(element, 'ohne-card') && element.textContent.includes(name),
      )[0]!;
    strictEqual(labelled(row('Titles'), 'dashboard.bookmarks.applied').length, 1);
    dispatch(labelled(row('Team'), 'dashboard.apply')[0]!, 'click');
    await new Promise((resolve) => setTimeout(resolve, 350));
    await idle();
    strictEqual(decodeURIComponent(location.search), '?order=[-title]&utm=x');
    scope?.dispose();
    await navigate('/collections/posts');
    await idle();
  });
});

describe('collectionTable duplicate', () => {
  const ROUTE = 'POST /collections/[collection]/[uuid]/duplicate';
  const allowed = { allowed: true, public: false, scoped: false };
  const META: Omit<DashboardMeta, 'routes'> = {
    menu: [],
    collections: [],
    blocks: [],
    roles: [],
    capabilities: [],
    locales: ['en'],
    defaultLocale: 'en',
    languages: ['en'],
    accountFields: [],
    accountLayout: [],
    defaultViews: {},
  };
  const HEROES: DashboardCollection = {
    name: 'Heroes',
    segment: 'heroes',
    label: 'Heroes',
    translatable: false,
    singleton: false,
    duplicable: true,
    operations: { read: allowed, create: allowed, update: null, delete: null },
    fields: [
      {
        name: 'name',
        type: 'text',
        kind: 'column',
        logicalType: 'text',
        label: 'Name',
        nullable: false,
        required: false,
        unique: false,
        translatable: false,
        readable: true,
        writable: true,
        immutable: false,
      },
    ],
    labelFields: ['name'],
    table: { columns: ['name'] },
  };
  const PAGE = {
    records: [{ UUID: 'u-thrall', name: 'Thrall' }],
    page: 1,
    lastPage: 1,
    perPage: 50,
  };
  const posts: { path: string; body: string }[] = [];
  let reads = 0;
  let routes: string[] = [];
  let scope: ReturnType<typeof effectScope> | undefined;
  let collectionTable!: (collection: DashboardCollection) => unknown;

  const findAll = (root: FakeNode, match: (element: FakeElement) => boolean): FakeElement[] =>
    root.childNodes.flatMap((child) => [
      ...(child instanceof FakeElement && match(child) ? [child] : []),
      ...findAll(child, match),
    ]);
  const body = (): FakeElement => document.body as unknown as FakeElement;

  /**
   * Serves `next` as the app's routes, mounts the heroes table, and opens Thrall's row menu.
   * Resolves the labels of its menu rows; without catalogs a label reads as its key.
   */
  const menuOf = async (
    collection: DashboardCollection,
    next: string[],
  ): Promise<FakeElement[]> => {
    routes = next;
    invalidateDashboardMeta();
    dashboardMeta();
    await idle();
    scope?.dispose();
    scope = effectScope();
    const root = scope.run(() => h('div', null, collectionTable(collection) as Node))!;
    await idle();
    const kebab = findAll(root as unknown as FakeElement, (element) =>
      hasClass(element, 'ohne-table-kebab'),
    )[0]!;
    dispatch(kebab, 'click');
    flush();
    const menu = findAll(body(), (element) => element.getAttribute('role') === 'menu').at(-1)!;
    return findAll(menu, (element) => element.getAttribute('role') === 'menuitem');
  };

  before(async () => {
    Object.assign(globalThis, {
      fetch: async (url: string, init?: RequestInit) => {
        const path = new URL(url).pathname;
        if (path === '/dashboard') return Response.json({ ...META, routes });
        if (path.endsWith('/query')) {
          reads += 1;
          return Response.json({ ...PAGE, total: 1 });
        }
        if (path.endsWith('/duplicate')) {
          posts.push({ path, body: String(init?.body) });
          return Response.json({ UUID: 'u-copy', name: 'Thrall' }, { status: 201 });
        }
        return new Response(null, { status: 404 });
      },
    });
    ({ collectionTable } =
      await import('../../../../src/base/dashboard/components/collection-table.ts'));
  });

  it('duplicates a row with an empty body, then reloads the page', async () => {
    const items = await menuOf(HEROES, [ROUTE]);
    const item = items.find((element) => element.textContent === 'dashboard.duplicate')!;
    const before = reads;
    dispatch(item, 'click');
    await idle();
    deepStrictEqual(posts, [{ path: '/collections/heroes/u-thrall/duplicate', body: '{}' }]);
    strictEqual(reads, before + 1);
    scope?.dispose();
  });

  it('offers no Duplicate where the route, the create, or a copy without input is missing', async () => {
    const labels = async (collection: DashboardCollection, next: string[]): Promise<string[]> =>
      (await menuOf(collection, next)).map((element) => element.textContent);
    strictEqual((await labels(HEROES, [])).includes('dashboard.duplicate'), false);
    strictEqual(
      (await labels({ ...HEROES, duplicable: false }, [ROUTE])).includes('dashboard.duplicate'),
      false,
    );
    strictEqual(
      (
        await labels({ ...HEROES, operations: { ...HEROES.operations, create: null } }, [ROUTE])
      ).includes('dashboard.duplicate'),
      false,
    );
    scope?.dispose();
  });
});

describe('collectionTable row menu', () => {
  const ROUTE = 'POST /collections/[collection]/[uuid]/duplicate';
  const allowed = { allowed: true, public: false, scoped: false };
  const META: DashboardMeta = {
    menu: [],
    collections: [],
    blocks: [],
    roles: [],
    capabilities: [],
    routes: [ROUTE],
    locales: ['en', 'de'],
    defaultLocale: 'en',
    languages: ['en'],
    accountFields: [],
    accountLayout: [],
    defaultViews: {},
  };
  const GUILD: DashboardCollection = {
    name: 'Guild',
    segment: 'guild',
    label: 'Guild',
    translatable: false,
    singleton: false,
    duplicable: true,
    operations: { read: allowed, create: null, update: null, delete: null },
    fields: [
      {
        name: 'name',
        type: 'text',
        kind: 'column',
        logicalType: 'text',
        label: 'Name',
        nullable: false,
        required: false,
        unique: false,
        translatable: false,
        readable: true,
        writable: true,
        immutable: false,
      },
    ],
    labelFields: ['name'],
    table: { columns: ['name'] },
  };
  const PAGE = {
    records: [
      { UUID: 'u-thrall', name: 'Thrall' },
      { UUID: 'u-jaina', name: 'Jaina' },
      { UUID: 'u-anduin', name: 'Anduin' },
    ],
    page: 1,
    lastPage: 1,
    perPage: 50,
    total: 3,
  };
  let scope: ReturnType<typeof effectScope> | undefined;
  let collectionTable!: (collection: DashboardCollection) => unknown;
  let dialogHost!: () => unknown;

  const findAll = (root: FakeNode, match: (element: FakeElement) => boolean): FakeElement[] =>
    root.childNodes.flatMap((child) => [
      ...(child instanceof FakeElement && match(child) ? [child] : []),
      ...findAll(child, match),
    ]);
  const body = (): FakeElement => document.body as unknown as FakeElement;
  const lastMenu = (): FakeElement =>
    findAll(body(), (element) => element.getAttribute('role') === 'menu').at(-1)!;
  const rowOf = (root: FakeElement, name: string): FakeElement =>
    findAll(root, (element) => element.tagName === 'TR' && element.textContent.includes(name))[0]!;
  const kebabOf = (root: FakeElement, name: string): FakeElement | undefined =>
    findAll(rowOf(root, name), (element) => hasClass(element, 'ohne-table-kebab'))[0];

  /**
   * The shape of the row's right-click menu, asserted equal to its kebab's; no rows reads as `''`.
   */
  const shape = (root: FakeElement, name: string): string => {
    let prevented = false;
    dispatch(rowOf(root, name), 'contextmenu', {
      clientX: 0,
      clientY: 0,
      preventDefault: () => {
        prevented = true;
      },
    });
    flush();
    const viaRightClick = prevented ? shapeOfDOM(lastMenu()) : '';
    const kebab = kebabOf(root, name);
    if (isUndefined(kebab)) {
      strictEqual(viaRightClick, '');
      return '';
    }
    dispatch(kebab, 'click');
    flush();
    strictEqual(shapeOfDOM(lastMenu()), viaRightClick);
    dispatch(kebab, 'click');
    flush();
    return viaRightClick;
  };

  const pick = (root: FakeElement, name: string, label: string): void => {
    dispatch(rowOf(root, name), 'contextmenu', { clientX: 0, clientY: 0 });
    flush();
    const row = findAll(
      lastMenu(),
      (element) => element.getAttribute('role') === 'menuitem' && labelOf(element) === label,
    )[0]!;
    dispatch(row, 'click');
    flush();
  };
  const labelOf = (row: FakeElement): string =>
    findAll(row, (element) => element.tagName === 'KBD').reduce(
      (text, hint) => text.replace(hint.textContent, ''),
      row.textContent,
    );

  /**
   * Mounts the guild table with `rights` granted, translatable or not, and lets its page land.
   */
  const sheet = async (rights: Rights, translatable: boolean): Promise<FakeElement> => {
    scope?.dispose();
    scope = effectScope();
    const operations = {
      read: allowed,
      create: rights.includes('create') ? allowed : null,
      update: rights.includes('update') ? allowed : null,
      delete: rights.includes('delete') ? allowed : null,
    };
    const root = scope.run(() =>
      h(
        'div',
        null,
        collectionTable({ ...GUILD, translatable, operations }) as Node,
        dialogHost() as Node,
      ),
    )!;
    await idle();
    return root as unknown as FakeElement;
  };

  type Rights = readonly ('create' | 'update' | 'delete')[];

  const go = (update: boolean): string =>
    `${update ? 'dashboard.edit' : 'dashboard.view'}, dashboard.openInNewTab`;
  const T = ', dashboard.translations.translate';
  const DUP = ', dashboard.duplicate';
  const SEVERAL = 'dashboard.clearSelection | dashboard.table.deleteCount[delete]';

  const matrix: {
    name: string;
    rights: Rights;
    translatable: boolean;
    alone: string;
    selectedAlone?: string;
  }[] = [
    { name: 'read', rights: [], translatable: false, alone: go(false) },
    { name: 'read + translate', rights: [], translatable: true, alone: go(false) + T },
    { name: 'update', rights: ['update'], translatable: false, alone: go(true) },
    { name: 'read + duplicate', rights: ['create'], translatable: false, alone: go(false) + DUP },
    {
      name: 'update + translate + duplicate',
      rights: ['update', 'create'],
      translatable: true,
      alone: go(true) + T + DUP,
    },
    {
      name: 'delete',
      rights: ['delete'],
      translatable: false,
      alone: `${go(false)} | dashboard.select | dashboard.delete`,
      selectedAlone: `${go(false)} | dashboard.deselect | dashboard.delete[delete]`,
    },
    {
      name: 'update + delete',
      rights: ['update', 'delete'],
      translatable: false,
      alone: `${go(true)} | dashboard.select | dashboard.delete`,
      selectedAlone: `${go(true)} | dashboard.deselect | dashboard.delete[delete]`,
    },
    {
      name: 'every right',
      rights: ['create', 'update', 'delete'],
      translatable: true,
      alone: `${go(true)}${T}${DUP} | dashboard.select | dashboard.delete`,
      selectedAlone: `${go(true)}${T}${DUP} | dashboard.deselect | dashboard.delete[delete]`,
    },
  ];

  before(async () => {
    Object.assign(globalThis, {
      fetch: async (url: string) => {
        const path = new URL(url).pathname;
        if (path === '/dashboard') return Response.json(META);
        if (path.endsWith('/query')) return Response.json(PAGE);
        return new Response(null, { status: 404 });
      },
    });
    ({ collectionTable } =
      await import('../../../../src/base/dashboard/components/collection-table.ts'));
    ({ dialogHost } = await import('../../../../src/dashboard/ui/dialog.ts'));
    invalidateDashboardMeta();
    dashboardMeta();
    await idle();
  });

  for (const row of matrix) {
    it(`shows the grammar for ${row.name}`, async () => {
      const root = await sheet(row.rights, row.translatable);
      strictEqual(shape(root, 'Jaina'), row.alone);
      if (isUndefined(row.selectedAlone)) return;
      pick(root, 'Jaina', 'dashboard.select');
      strictEqual(shape(root, 'Jaina'), row.selectedAlone);
      strictEqual(shape(root, 'Thrall'), row.alone);
      pick(root, 'Thrall', 'dashboard.select');
      pick(root, 'Anduin', 'dashboard.select');
      strictEqual(shape(root, 'Jaina'), SEVERAL);
    });
  }

  it('confirms deleting the selection on a Delete pick from the row selected alone', async () => {
    const root = await sheet(['delete'], false);
    pick(root, 'Jaina', 'dashboard.select');
    pick(root, 'Jaina', 'dashboard.delete');
    await idle();
    const texts = findAll(body(), (element) => element.textContent.startsWith('dashboard.table'));
    strictEqual(
      texts.some((element) => element.textContent === 'dashboard.table.confirmDeleteMany'),
      true,
    );
    strictEqual(
      texts.some((element) => element.textContent === 'dashboard.table.confirmDeleteOne'),
      false,
    );
    scope?.dispose();
  });
});
