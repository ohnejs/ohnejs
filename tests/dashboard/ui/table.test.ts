import { deepStrictEqual, strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import type { TableColumn, TableSort } from '../../../src/dashboard/ui/table-model.ts';
import type { TableOptions } from '../../../src/dashboard/ui/table.ts';

import { flush } from '../../../src/utils/reactive/_scheduler.ts';
import { effectScope } from '../../../src/utils/reactive/effect-scope.ts';
import { ref } from '../../../src/utils/reactive/ref.ts';
import { FakeElement, type FakeNode, findElement, hasClass } from '../_fake-dom.ts';
import { requests, settle } from '../_fake-fetch.ts';
import './_events.ts';

type Listener = (event: unknown) => void;

const handlers = new WeakMap<object, Map<string, Listener[]>>();
const inherited = (
  FakeElement.prototype as unknown as {
    addEventListener: (this: FakeElement, type: string, listener: Listener) => void;
  }
).addEventListener;
Object.assign(FakeElement.prototype, {
  addEventListener(this: FakeElement, type: string, listener: Listener) {
    const byType = handlers.get(this) ?? new Map<string, Listener[]>();
    handlers.set(this, byType);
    byType.set(type, [...(byType.get(type) ?? []), listener]);
    inherited.call(this, type, listener);
  },
});

const windowHandlers = new Map<string, Listener[]>();
const opened: string[] = [];
Object.assign(window, {
  navigator: { userAgent: 'node' },
  addEventListener: (type: string, listener: Listener) =>
    windowHandlers.set(type, [...(windowHandlers.get(type) ?? []), listener]),
  removeEventListener() {},
  open: (url: string) => opened.push(url),
  getSelection: () => ({ removeAllRanges() {} }),
});
Object.assign(globalThis, {
  location: { pathname: '/', search: '', hash: '', href: 'http://dashboard/' },
});

const { table } = await import('../../../src/dashboard/ui/table.ts');
const { setNavigationGuard } = await import('../../../src/dashboard/router/router.ts');
const { useResource } = await import('../../../src/dashboard/runtime/resource.ts');

interface Raider {
  name: string;
  role: string;
  level: number | null;
}

const RAIDERS: Raider[] = [
  { name: 'Thrall', role: 'Shaman', level: 80 },
  { name: 'Jaina', role: 'Mage', level: 1234 },
  { name: 'Sylvanas', role: 'Hunter', level: null },
  { name: 'Anduin', role: 'Priest', level: 70 },
];

const COLUMNS: Record<string, TableColumn<Raider>> = {
  name: { label: 'Name', value: (raider) => raider.name, sortable: 'text' },
  role: { label: 'Role', render: (raider) => `${raider.role}!` },
  level: { label: 'Level', value: (raider) => raider.level, sortable: 'numeric', align: 'end' },
};

/**
 * Runs every `type` listener `element` holds with a minimal event carrying `extra`, and returns it.
 */
function dispatch(element: FakeElement, type: string, extra: Record<string, unknown> = {}) {
  const event = {
    type,
    target: element,
    currentTarget: element,
    defaultPrevented: false,
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    altKey: false,
    button: 0,
    key: '',
    preventDefault() {
      event.defaultPrevented = true;
    },
    stopPropagation() {},
    ...extra,
  };
  for (const listener of handlers.get(element)?.get(type) ?? []) listener(event);
  return event;
}

/**
 * Presses or releases Shift on the window.
 */
function shift(down: boolean): void {
  for (const listener of windowHandlers.get(down ? 'keydown' : 'keyup') ?? []) {
    listener({ key: 'Shift' });
  }
}

/**
 * Every element under `root` that `match` accepts, depth first.
 */
function findAll(root: FakeNode, match: (element: FakeElement) => boolean): FakeElement[] {
  return root.childNodes.flatMap((child) => [
    ...(child instanceof FakeElement && match(child) ? [child] : []),
    ...findAll(child, match),
  ]);
}

const byTag = (root: FakeNode, tag: string): FakeElement[] =>
  findAll(root, (element) => element.tagName === tag);
const byClass = (root: FakeNode, name: string): FakeElement[] =>
  findAll(root, (element) => hasClass(element, name));
const bodyRows = (root: FakeElement): FakeElement[] => byTag(byTag(root, 'TBODY')[0]!, 'TR');
const names = (root: FakeElement): string[] =>
  bodyRows(root).map(
    (row) => byTag(row, 'TD').find((cell) => cell.textContent !== '')!.textContent,
  );
const rowOf = (root: FakeElement, name: string): FakeElement =>
  bodyRows(root).find((row) => row.textContent.includes(name))!;
const sortButton = (root: FakeElement, label: string): FakeElement =>
  byClass(root, 'ohne-table-sort').find((button) => button.textContent === label)!;
const headerOf = (root: FakeElement, label: string): FakeElement =>
  byTag(root, 'TH').find((cell) => cell.textContent === label)!;

/**
 * Clicks the checkbox of the row showing `name`, flipping it as the native input would.
 */
function toggle(root: FakeElement, name: string): void {
  const input = byTag(rowOf(root, name), 'INPUT')[0]! as FakeElement & { checked: boolean };
  input.checked = !input.checked;
  dispatch(input, 'change');
  flush();
}

/**
 * A raid table over `rows` with the shared columns, keyed by name.
 */
function raidTable(
  rows: () => readonly Raider[] | undefined,
  options: Partial<TableOptions<Raider, string, string>> = {},
): FakeElement {
  const root = table(rows, { key: (raider) => raider.name, columns: COLUMNS, ...options });
  flush();
  return root as unknown as FakeElement;
}

describe('table', () => {
  it('renders a header and a cell per column', () => {
    const root = raidTable(() => RAIDERS);
    deepStrictEqual(
      byTag(root, 'TH').map((cell) => cell.textContent),
      ['Name', 'Role', 'Level'],
    );
    deepStrictEqual(
      bodyRows(root).map((row) => byTag(row, 'TD').map((cell) => cell.textContent)),
      [
        ['Thrall', 'Shaman!', '80'],
        ['Jaina', 'Mage!', '1,234'],
        ['Sylvanas', 'Hunter!', ''],
        ['Anduin', 'Priest!', '70'],
      ],
    );
    const level = byTag(bodyRows(root)[0]!, 'TD')[2]!;
    strictEqual(hasClass(level, 'ohne-table-end'), true);
    strictEqual(byClass(level, 'ohne-table-number').length, 1);
    strictEqual(hasClass(byTag(bodyRows(root)[0]!, 'TD')[0]!, 'ohne-table-first'), true);
  });

  it('sorts on the client by header clicks, missing values last', () => {
    const root = raidTable(() => RAIDERS);
    strictEqual(headerOf(root, 'Name').getAttribute('aria-sort'), 'none');
    dispatch(sortButton(root, 'Name'), 'click');
    flush();
    deepStrictEqual(names(root), ['Anduin', 'Jaina', 'Sylvanas', 'Thrall']);
    strictEqual(headerOf(root, 'Name').getAttribute('aria-sort'), 'ascending');
    dispatch(sortButton(root, 'Name'), 'click');
    flush();
    deepStrictEqual(names(root), ['Thrall', 'Sylvanas', 'Jaina', 'Anduin']);
    strictEqual(headerOf(root, 'Name').getAttribute('aria-sort'), 'descending');
    dispatch(sortButton(root, 'Level'), 'click');
    flush();
    deepStrictEqual(names(root), ['Anduin', 'Thrall', 'Jaina', 'Sylvanas']);
    strictEqual(headerOf(root, 'Name').getAttribute('aria-sort'), 'none');
  });

  it('offers no sort on a client column without a value', () => {
    const root = raidTable(() => RAIDERS, {
      columns: { role: { label: 'Role', sortable: true, render: (raider) => raider.role } },
    });
    strictEqual(byClass(root, 'ohne-table-sort').length, 0);
    strictEqual(headerOf(root, 'Role').getAttribute('aria-sort'), null);
  });

  it('starts from the sort it is given and writes the next one back', () => {
    const sort = ref<TableSort | null>({ column: 'level', direction: 'desc' });
    const root = raidTable(() => RAIDERS, { sort });
    deepStrictEqual(names(root), ['Jaina', 'Thrall', 'Anduin', 'Sylvanas']);
    dispatch(sortButton(root, 'Name'), 'click');
    flush();
    deepStrictEqual(sort.value, { column: 'name', direction: 'asc' });
    deepStrictEqual(names(root), ['Anduin', 'Jaina', 'Sylvanas', 'Thrall']);
  });

  it('only writes the sort when the server sorts', () => {
    const sort = ref<TableSort | null>(null);
    const root = raidTable(() => RAIDERS, { sort, serverSort: true });
    dispatch(sortButton(root, 'Name'), 'click');
    flush();
    deepStrictEqual(sort.value, { column: 'name', direction: 'asc' });
    deepStrictEqual(names(root), ['Thrall', 'Jaina', 'Sylvanas', 'Anduin']);
  });

  it('shows skeleton rows while the rows are loading', () => {
    const rows = ref<Raider[] | undefined>(undefined);
    const root = raidTable(() => rows.value);
    const grid = byTag(root, 'TABLE')[0]!;
    strictEqual(grid.getAttribute('aria-busy'), 'true');
    strictEqual(bodyRows(root).length, 5);
    strictEqual(byClass(bodyRows(root)[0]!, 'ohne-skeleton').length, 3);
    strictEqual(bodyRows(raidTable(() => undefined, { pageSize: 3 })).length, 3);
    rows.value = RAIDERS;
    flush();
    strictEqual(grid.getAttribute('aria-busy'), null);
    deepStrictEqual(names(root), ['Thrall', 'Jaina', 'Sylvanas', 'Anduin']);
  });

  it('shows the empty state across every column', () => {
    const plain = raidTable(() => []);
    strictEqual(bodyRows(plain)[0]!.textContent, 'No data available');
    strictEqual(byTag(plain, 'TD')[0]!.getAttribute('colspan'), '3');
    strictEqual(
      bodyRows(raidTable(() => [], { empty: 'No raiders yet' }))[0]!.textContent,
      'No raiders yet',
    );
    const custom = new FakeElement('p');
    custom.appendChild(document.createTextNode('The raid disbanded') as unknown as FakeNode);
    const root = raidTable(() => [], { empty: custom as unknown as Node });
    strictEqual(byTag(root, 'P')[0], custom);
  });

  it('shows the forbidden and error states of a resource, with a retry', async () => {
    const scope = effectScope();
    const [forbidden, failing] = scope.run(() => [
      useResource<Raider[]>('GET /raids/officers'),
      useResource<Raider[]>('GET /raids'),
    ])!;
    const locked = raidTable(forbidden);
    const broken = raidTable(failing);
    strictEqual(bodyRows(broken).length, 5);
    requests.find((request) => request.url.includes('officers'))!.answer(403, {});
    requests
      .find((request) => !request.url.includes('officers'))!
      .answer(500, {
        statusCode: 500,
        message: 'The portal collapsed',
      });
    await settle();
    flush();
    strictEqual(bodyRows(locked)[0]!.textContent, 'You do not have access to this');
    strictEqual(bodyRows(broken)[0]!.textContent, 'The portal collapsedRetry');
    const sent = requests.length;
    dispatch(byTag(bodyRows(broken)[0]!, 'BUTTON')[0]!, 'click');
    strictEqual(requests.length, sent + 1);
    scope.dispose();
  });

  it('pages the rows, clamps the page when rows shrink, and returns to page one on a sort', () => {
    const rows = ref([...RAIDERS, { name: 'Baine', role: 'Warrior', level: 60 }]);
    const root = raidTable(() => rows.value, { pageSize: 2 });
    const next = findAll(root, (element) => element.getAttribute('title') === 'Next page')[0]!;
    deepStrictEqual(names(root), ['Thrall', 'Jaina']);
    dispatch(next, 'click');
    dispatch(next, 'click');
    flush();
    deepStrictEqual(names(root), ['Baine']);
    rows.value = RAIDERS;
    flush();
    deepStrictEqual(names(root), ['Sylvanas', 'Anduin']);
    dispatch(sortButton(root, 'Name'), 'click');
    flush();
    deepStrictEqual(names(root), ['Anduin', 'Jaina']);
  });

  it('closes an open actions menu when the rows change', () => {
    const rows = ref(RAIDERS);
    const picked: string[] = [];
    const root = raidTable(() => rows.value, {
      actions: (raider) => [
        { label: `Invite ${raider.name}`, onSelect: () => picked.push(raider.name) },
      ],
    });
    const panel = (): FakeElement | undefined =>
      findElement(
        document.body as unknown as FakeElement,
        (element) => element.getAttribute('role') === 'menu',
      );
    dispatch(byClass(rowOf(root, 'Jaina'), 'ohne-table-kebab')[0]!, 'click');
    flush();
    strictEqual(panel()?.textContent, 'Invite Jaina');
    dispatch(
      findAll(panel()!, (element) => element.getAttribute('role') === 'menuitem')[0]!,
      'click',
    );
    deepStrictEqual(picked, ['Jaina']);
    dispatch(byClass(rowOf(root, 'Thrall'), 'ohne-table-kebab')[0]!, 'click');
    flush();
    strictEqual(panel()?.textContent, 'Invite Thrall');
    rows.value = [...RAIDERS];
    flush();
    strictEqual(panel(), undefined);
  });
});

describe('table selection', () => {
  it('writes a new set per click, keeping the click order', () => {
    const selected = ref<ReadonlySet<string>>(new Set());
    const root = raidTable(() => RAIDERS, { selection: { selected } });
    toggle(root, 'Jaina');
    const first = selected.value;
    toggle(root, 'Thrall');
    deepStrictEqual([...selected.value], ['Jaina', 'Thrall']);
    strictEqual(first !== selected.value, true);
    toggle(root, 'Jaina');
    deepStrictEqual([...selected.value], ['Thrall']);
  });

  it('names the select-all box and every row box', () => {
    const selected = ref<ReadonlySet<string>>(new Set());
    const root = raidTable(() => RAIDERS, { selection: { selected } });
    flush();
    const names = findAll(root, (element) => element.getAttribute('role') === 'checkbox').map(
      (box) => box.getAttribute('aria-label'),
    );
    deepStrictEqual(names, ['Select all', ...RAIDERS.map(() => 'Select row')]);
  });

  it('ranges with Shift from the anchor, skipping refused rows', () => {
    const selected = ref<ReadonlySet<string>>(new Set());
    const root = raidTable(() => RAIDERS, {
      selection: { selected, selectable: (raider) => raider.name !== 'Jaina' },
    });
    strictEqual(byClass(rowOf(root, 'Jaina'), 'ohne-checkbox-disabled').length, 1);
    toggle(root, 'Thrall');
    shift(true);
    toggle(root, 'Anduin');
    shift(false);
    deepStrictEqual([...selected.value], ['Thrall', 'Sylvanas', 'Anduin']);
  });

  it('anchors a programmatic single add and forgets a deselected anchor', () => {
    const selected = ref<ReadonlySet<string>>(new Set());
    const root = raidTable(() => RAIDERS, { selection: { selected } });
    selected.value = new Set(['Thrall']);
    flush();
    shift(true);
    toggle(root, 'Sylvanas');
    shift(false);
    deepStrictEqual([...selected.value], ['Thrall', 'Jaina', 'Sylvanas']);
    selected.value = new Set(['Jaina']);
    toggle(root, 'Jaina');
    shift(true);
    toggle(root, 'Anduin');
    shift(false);
    deepStrictEqual([...selected.value], ['Anduin']);
  });

  it('keeps the anchor while streamed rows arrive selected', () => {
    const rows = ref<Raider[]>([]);
    const selected = ref<ReadonlySet<string>>(new Set());
    const root = raidTable(() => rows.value, { selection: { selected } });
    const stream = (raider: Raider): void => {
      selected.value = new Set(selected.value).add(raider.name);
      rows.value = [...rows.value, raider];
      flush();
    };
    for (const raider of RAIDERS.slice(0, 3)) stream(raider);
    toggle(root, 'Thrall');
    toggle(root, 'Thrall');
    stream(RAIDERS[3]!);
    shift(true);
    toggle(root, 'Jaina');
    shift(false);
    deepStrictEqual([...selected.value], ['Sylvanas', 'Thrall', 'Anduin']);
  });

  it('anchors a programmatic single add after the rows changed alone', () => {
    const rows = ref<Raider[]>(RAIDERS.slice(0, 3));
    const selected = ref<ReadonlySet<string>>(new Set());
    const root = raidTable(() => rows.value, { selection: { selected } });
    rows.value = [...RAIDERS];
    flush();
    selected.value = new Set(['Thrall']);
    flush();
    shift(true);
    toggle(root, 'Sylvanas');
    shift(false);
    deepStrictEqual([...selected.value], ['Thrall', 'Jaina', 'Sylvanas']);
  });

  it('acts as a plain click when the anchor is on another page, and keeps that page selected', () => {
    const selected = ref<ReadonlySet<string>>(new Set());
    const root = raidTable(() => RAIDERS, { selection: { selected }, pageSize: 2 });
    toggle(root, 'Thrall');
    dispatch(
      findAll(root, (element) => element.getAttribute('title') === 'Next page')[0]!,
      'click',
    );
    flush();
    shift(true);
    toggle(root, 'Anduin');
    shift(false);
    deepStrictEqual([...selected.value], ['Thrall', 'Anduin']);
  });

  it('selects all of the page with the built-in box, then clears only those rows', () => {
    const selected = ref<ReadonlySet<string>>(new Set(['Garrosh']));
    const root = raidTable(() => RAIDERS, {
      selection: { selected, selectable: (raider) => raider.name !== 'Jaina' },
    });
    const box = byTag(
      byClass(byTag(root, 'THEAD')[0]!, 'ohne-table-check')[0]!,
      'INPUT',
    )[0]! as FakeElement & {
      checked: boolean;
    };
    box.checked = true;
    dispatch(box, 'change');
    flush();
    deepStrictEqual([...selected.value], ['Garrosh', 'Thrall', 'Sylvanas', 'Anduin']);
    toggle(root, 'Thrall');
    strictEqual(box.checked, true);
    box.checked = false;
    dispatch(box, 'change');
    flush();
    deepStrictEqual([...selected.value], ['Garrosh']);
  });

  it('hands the select-all box to an override', () => {
    const calls: boolean[] = [];
    const root = raidTable(() => RAIDERS, {
      selection: {
        selected: ref(new Set()),
        all: { state: () => 'indeterminate', toggle: (value) => void calls.push(value) },
      },
    });
    const box = byTag(
      byClass(byTag(root, 'THEAD')[0]!, 'ohne-table-check')[0]!,
      'INPUT',
    )[0]! as FakeElement & {
      checked: boolean;
    };
    strictEqual(box.checked, true);
    box.checked = false;
    dispatch(box, 'change');
    deepStrictEqual(calls, [false]);
  });

  it('shows the checkbox column only while `checkboxes` says so', () => {
    const shown = ref(false);
    const root = raidTable(() => RAIDERS, {
      selection: { selected: ref(new Set()), checkboxes: () => shown.value },
    });
    strictEqual(byTag(root, 'TH').length, 3);
    shown.value = true;
    flush();
    strictEqual(byTag(root, 'TH').length, 4);
    strictEqual(byClass(rowOf(root, 'Thrall'), 'ohne-table-check').length, 1);
  });
});

describe('table rows that open', () => {
  it('navigates on a click and opens a new tab on a modifier or middle click', () => {
    const visits: string[] = [];
    setNavigationGuard((path) => {
      visits.push(path);
      return false;
    });
    const root = raidTable(() => RAIDERS, { href: (raider) => `/raiders/${raider.name}` });
    const row = rowOf(root, 'Jaina');
    strictEqual(row.getAttribute('tabindex'), '0');
    dispatch(row, 'click');
    deepStrictEqual(visits, ['/raiders/Jaina']);
    dispatch(row, 'click', { metaKey: true });
    dispatch(row, 'auxclick', { button: 1 });
    dispatch(row, 'auxclick', { button: 2 });
    deepStrictEqual(opened.splice(0), ['/raiders/Jaina', '/raiders/Jaina']);
    deepStrictEqual(visits, ['/raiders/Jaina']);
    setNavigationGuard(null);
  });

  it('ignores a click that starts inside a control', () => {
    const seen: string[] = [];
    const root = raidTable(() => RAIDERS, { onOpen: (raider) => seen.push(raider.name) });
    const control = Object.assign(new FakeElement('button'), { closest: () => control });
    dispatch(rowOf(root, 'Thrall'), 'click', { target: control });
    deepStrictEqual(seen, []);
    dispatch(rowOf(root, 'Thrall'), 'click');
    deepStrictEqual(seen, ['Thrall']);
  });

  it('opens on a double-click when the table selects, and on Enter', () => {
    const seen: string[] = [];
    const root = raidTable(() => RAIDERS, {
      selection: { selected: ref(new Set()) },
      onOpen: (raider) => seen.push(raider.name),
    });
    const row = rowOf(root, 'Anduin');
    dispatch(row, 'click');
    deepStrictEqual(seen, []);
    dispatch(row, 'dblclick');
    dispatch(row, 'keydown', { key: 'Enter' });
    dispatch(row, 'keydown', { key: 'Enter', target: new FakeElement('input') });
    deepStrictEqual(seen, ['Anduin', 'Anduin']);
  });
});

describe('table types', () => {
  it('infers rows, keys, and column names', () => {
    const probe = (): void => {
      table(() => RAIDERS, {
        key: (raider) => raider.name,
        columns: {
          name: { render: (raider) => raider.name.toUpperCase() },
          level: { value: (raider) => raider.level },
        },
        sort: ref({ column: 'level', direction: 'desc' }),
      });
      const named = ref<TableSort<'name' | 'guild'> | null>(null);
      table(() => RAIDERS, {
        key: (raider) => raider.name,
        // @ts-expect-error The sort names a `guild` column the table lacks.
        columns: { name: { value: (raider) => raider.name } },
        sort: named,
      });
      table(() => RAIDERS, {
        key: (raider) => raider.name,
        // @ts-expect-error A raider has no `guild`.
        columns: { name: { render: (raider) => raider.guild } },
      });
      table(() => RAIDERS, {
        // @ts-expect-error The selection holds numbers, but the rows key by name.
        key: (raider) => raider.name,
        columns: { name: { value: (raider) => raider.name } },
        selection: { selected: ref<ReadonlySet<number>>(new Set()) },
      });
    };
    strictEqual(typeof probe, 'function');
  });
});
