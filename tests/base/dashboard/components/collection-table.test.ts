import { deepStrictEqual, strictEqual } from 'node:assert';
import { before, describe, it } from 'node:test';

import type {
  DashboardCollection,
  DashboardField,
} from '../../../../src/dashboard/runtime/meta-types.ts';
import type { FakeBrowser } from '../../../dashboard/router/_browser.ts';

import { h } from '../../../../src/dashboard/render/h.ts';
import { defineDashboardPage } from '../../../../src/dashboard/router/define-dashboard-page.ts';
import { navigate, startRouter } from '../../../../src/dashboard/router/router.ts';
import { flush } from '../../../../src/utils/reactive/_scheduler.ts';
import { effectScope } from '../../../../src/utils/reactive/effect-scope.ts';
import { FakeElement, type FakeNode, findElement } from '../../../dashboard/_fake-dom.ts';
import { pageModule, settle } from '../../../dashboard/router/_browser.ts';
import { baseBrowser } from '../_browser.ts';

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
  operations: {
    read: { allowed: true, public: false, scoped: false },
    create: null,
    update: null,
    delete: null,
  },
  fields: [],
  labelFields: [],
};

describe('collectionTable', () => {
  let browser!: FakeBrowser;
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
      [{ pattern: '/collections/posts', url: pageModule('posts') }],
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
  const sheet = async (): Promise<FakeElement> => {
    scope?.dispose();
    scope = effectScope();
    const root = scope.run(() =>
      h('div', null, collectionTable(RAIDERS) as Node, dialogHost() as Node),
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

  it('shows the empty state for a page without records', async () => {
    records = [];
    const root = await sheet();
    strictEqual(bodyRows(root)[0]!.textContent, 'No data available');
    records = RECORDS;
    scope?.dispose();
  });
});
