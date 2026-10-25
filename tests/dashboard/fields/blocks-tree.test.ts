import { deepStrictEqual, strictEqual } from 'node:assert';
import { afterEach, before, describe, it, mock } from 'node:test';

import type { BlocksTree } from '../../../src/dashboard/fields/blocks-tree.ts';
import type { BlocksHandle } from '../../../src/dashboard/fields/builtin/blocks.ts';
import type { DashboardField } from '../../../src/dashboard/runtime/meta-types.ts';

import { flush } from '../../../src/utils/reactive/_scheduler.ts';
import { effectScope } from '../../../src/utils/reactive/effect-scope.ts';
import { FakeElement, findElement, hasClass, resizeTo } from '../_fake-dom.ts';
import { seedMessages } from '../_fake-messages.ts';
import { bubble, fire, matchSelectors, trackRowFocus } from '../ui/_events.ts';
import { shapeOfDOM } from '../ui/_menu-shape.ts';
import './_controls.ts';

await seedMessages(
  { 'dashboard.blocks.deleteCount': 'Delete {count, plural, one {# block} other {# blocks}}' },
  'dashboard',
);

const { blocksTree } = await import('../../../src/dashboard/fields/blocks-tree.ts');
const { createFieldForm } = await import('../../../src/dashboard/fields/field-form.ts');
const { blocksHandleOf } = await import('../../../src/dashboard/fields/builtin/blocks.ts');
const { icon } = await import('../../../src/dashboard/ui/icon.ts');
const { clipboardData } = await import('../../../src/dashboard/fields/clipboard.ts');
const { dashboardMeta } = await import('../../../src/dashboard/runtime/meta.ts');
const { sessionUser } = await import('../../../src/dashboard/runtime/session.ts');
await import('../../../src/dashboard/fields/builtin/text.ts');

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
  required: false,
  unique: false,
  translatable: false,
  readable: true,
  writable: true,
  immutable: false,
};

/**
 * A `blocks` field named `name` that admits the types in `allow`.
 */
const blocksField = (name: string, allow: string[]): DashboardField =>
  ({
    ...TITLE,
    name,
    type: 'blocks',
    kind: 'childMany',
    logicalType: undefined,
    label: name,
    allow,
  }) as DashboardField;

/**
 * The block types the tree knows: a plain `Hero`, a `Group` that nests Heroes,
 * a `Shelf` whose nested list admits no known type, and a `Duo` with two nested lists.
 */
const BLOCKS = [
  { name: 'Hero', fields: [TITLE] },
  { name: 'Group', fields: [TITLE, blocksField('items', ['Hero'])] },
  { name: 'Shelf', fields: [TITLE, blocksField('items', ['Gone'])] },
  { name: 'Duo', fields: [TITLE, blocksField('left', ['Hero']), blocksField('right', ['Hero'])] },
].map((block) => ({ ...block, label: block.name, titleField: 'title' }));

type Stored = { block: string; fields: Record<string, unknown> };

/**
 * A stored block of type `block` titled `title`, with `nested` under its `items` list.
 */
const stored = (block: string, title: string, nested?: Stored[]): Stored => ({
  block,
  fields: nested ? { title, items: nested } : { title },
});

const hero = (title: string): Stored => stored('Hero', title);

const body = (): FakeElement => document.body as unknown as FakeElement;
const menus = (): FakeElement[] =>
  body().childNodes.filter(
    (node): node is FakeElement =>
      node instanceof FakeElement && node.getAttribute('role') === 'menu',
  );
const mounts: (() => void)[] = [];

/**
 * The label of a menu row, without its hotkey hint.
 */
const labelOf = (row: FakeElement): string =>
  row.textContent.replace(
    findElement(row, (child) => child.tagName === 'KBD')?.textContent ?? '',
    '',
  );

/**
 * The menu row labelled `label` under `panel`.
 */
function rowNamed(panel: FakeElement, label: string): FakeElement {
  return findElement(
    panel,
    (node) => node.getAttribute('role') === 'menuitem' && labelOf(node) === label,
  )!;
}

/**
 * The shape of the menu under `panel`, then the labels of its disabled rows.
 */
function menuOf(panel: FakeElement): [string, string[]] {
  const off: string[] = [];
  findElement(panel, (node) => {
    if (node.getAttribute('role') === 'menuitem' && node.getAttribute('aria-disabled') === 'true')
      off.push(labelOf(node));
    return false;
  });
  return [shapeOfDOM(panel), off];
}

/**
 * A blocks tree over `blocks` in a list admitting `allow`, mounted on the body, and its list.
 * `row(title)` finds the row of the block titled `title`.
 */
function mountTree(
  blocks: (string | Stored)[],
  { allow = ['Hero'], disabled = false }: { allow?: string[]; disabled?: boolean } = {},
): { tree: BlocksTree; list: BlocksHandle; row: (title?: string) => FakeElement } {
  const scope = effectScope(true);
  const { tree, list } = scope.run(() => {
    const form = createFieldForm(
      [blocksField('sections', allow)],
      { sections: blocks.map((block) => (typeof block === 'string' ? hero(block) : block)) },
      { mode: 'edit', path: '', language: () => 'en', disabled },
    );
    const handle = blocksHandleOf(form.controlOf('sections'))!;
    return { tree: blocksTree(() => handle), list: handle };
  })!;
  const element = tree.element as unknown as FakeElement;
  body().appendChild(element);
  // The tree renders only the rows its scroller's height shows, and a fake element measures none.
  findElement(element, (node) => {
    Object.assign(node, { offsetHeight: 1000 });
    resizeTo(node, 300);
    return false;
  });
  flush();
  mounts.push(() => {
    scope.dispose();
    element.remove();
  });
  const row = (title?: string): FakeElement =>
    findElement(
      element,
      (node) =>
        hasClass(node, 'ohne-tree-item-button') &&
        (title === undefined || node.textContent.includes(title)),
    )!;
  return { tree, list, row };
}

const rightClick = (target: FakeElement) =>
  fire(target, 'contextmenu', { target, clientX: 0, clientY: 0 });

/**
 * Right-clicks `row` and reads the menu it opens, as `menuOf` does.
 */
function rightMenu(row: FakeElement): [string, string[]] {
  rightClick(row);
  return menuOf(menus().at(-1)!);
}

const settled = async (): Promise<void> => {
  await new Promise((resolve) => setImmediate(resolve));
  flush();
};

const ADD = 'dashboard.sort.addBefore, dashboard.sort.addAfter';
const ADD3 = 'dashboard.sort.addBefore, dashboard.sort.addInside, dashboard.sort.addAfter';
const MOVE = 'dashboard.sort.moveUp, dashboard.sort.moveDown';
const CLIP = 'dashboard.clipboard.copy, dashboard.clipboard.cut';
const PASTE = 'dashboard.clipboard.pasteBefore, dashboard.clipboard.pasteAfter';
const PASTE3 =
  'dashboard.clipboard.pasteBefore, dashboard.clipboard.pasteInside, dashboard.clipboard.pasteAfter';
const ALONE = `${ADD}, dashboard.duplicate | ${CLIP} | dashboard.delete`;
const ALONE_KEYS =
  `${ADD}, dashboard.duplicate[duplicate]` +
  ' | dashboard.clipboard.copy[copy], dashboard.clipboard.cut[cut] | dashboard.delete[delete]';

matchSelectors();
trackRowFocus();
Object.assign(window, {
  getSelection: () => ({ isCollapsed: true, containsNode: () => false, removeAllRanges() {} }),
});

afterEach(() => {
  for (const dispose of mounts.splice(0)) dispose();
  clipboardData.value = null;
});

describe('blocksTree row menu', () => {
  before(async () => {
    Object.assign(globalThis, {
      getComputedStyle: () => ({
        display: 'block',
        getPropertyValue: (name: string) => (name === 'font-size' ? '16px' : ''),
      }),
    });
    mock.method(globalThis, 'fetch', async (url: string) => {
      if (!url.endsWith('/dashboard')) return new Response(JSON.stringify(ADMIN));
      return new Response(
        JSON.stringify({ collections: [], locales: [], menu: [], blocks: BLOCKS }),
      );
    });
    sessionUser();
    await settled();
    dashboardMeta();
    await settled();
  });

  it('opens on a right-click for the row alone, with no hints, and selects nothing', () => {
    const { tree, row } = mountTree(['Fall']);
    const event = rightClick(row());
    deepStrictEqual(
      [event.defaultPrevented, tree.selected(), menuOf(menus()[0]!)],
      [true, [], [ALONE, []]],
    );
  });

  it('names each hotkey once the row is in the selection', async () => {
    const { tree, list, row } = mountTree(['Fall']);
    tree.select([list.nodes()[0]!.$key]);
    await settled();
    deepStrictEqual(rightMenu(row()), [ALONE_KEYS, []]);
  });

  const cases: [string, (string | Stored)[], string[], string, unknown, [string, string[]]][] = [
    [
      'a row with a nested list, types offered, an empty clipboard',
      [hero('Fall'), stored('Group', 'Rise', []), hero('Wrath')],
      ['Hero', 'Group'],
      'Rise',
      null,
      [`${ADD3}, dashboard.duplicate, ${MOVE} | ${CLIP} | dashboard.delete`, []],
    ],
    [
      'a row with a nested list, blocks on the clipboard every list admits',
      [hero('Fall'), stored('Group', 'Rise', []), hero('Wrath')],
      ['Hero', 'Group'],
      'Rise',
      [{ $key: 'Hero' }],
      [`${ADD3}, dashboard.duplicate, ${MOVE} | ${CLIP}, ${PASTE3} | dashboard.delete`, []],
    ],
    [
      'a clipboard only the outer list admits',
      [hero('Fall'), stored('Group', 'Rise', []), hero('Wrath')],
      ['Hero', 'Group'],
      'Rise',
      [{ $key: 'Group' }],
      [`${ADD3}, dashboard.duplicate, ${MOVE} | ${CLIP}, ${PASTE} | dashboard.delete`, []],
    ],
    [
      'a clipboard each list admits in part',
      [hero('Fall'), stored('Group', 'Rise', []), hero('Wrath')],
      ['Hero', 'Group'],
      'Rise',
      [{ $key: 'Group' }, { $key: 'Hero' }],
      [`${ADD3}, dashboard.duplicate, ${MOVE} | ${CLIP}, ${PASTE3} | dashboard.delete`, []],
    ],
    [
      'a row with no nested list',
      ['Fall', 'Rise', 'Wrath'],
      ['Hero'],
      'Rise',
      null,
      [`${ADD}, dashboard.duplicate, ${MOVE} | ${CLIP} | dashboard.delete`, []],
    ],
    [
      'the first row, its move up off',
      ['Fall', 'Rise'],
      ['Hero'],
      'Fall',
      null,
      [
        `${ADD}, dashboard.duplicate, ${MOVE} | ${CLIP} | dashboard.delete`,
        ['dashboard.sort.moveUp'],
      ],
    ],
    [
      'the last row, its move down off',
      ['Fall', 'Rise'],
      ['Hero'],
      'Rise',
      null,
      [
        `${ADD}, dashboard.duplicate, ${MOVE} | ${CLIP} | dashboard.delete`,
        ['dashboard.sort.moveDown'],
      ],
    ],
    ['the only block in its list', ['Fall'], ['Hero'], 'Fall', null, [ALONE, []]],
    [
      'a list that no longer offers the row its type or any other',
      ['Fall', 'Rise', 'Wrath'],
      ['Gone'],
      'Rise',
      [{ $key: 'Hero' }],
      [`${MOVE} | ${CLIP} | dashboard.delete`, []],
    ],
    [
      'a row whose type its list no longer offers',
      [hero('Fall'), stored('Shelf', 'Rise', [hero('Dusk')])],
      ['Hero'],
      'Rise',
      null,
      [`${ADD}, ${MOVE} | ${CLIP} | dashboard.delete`, ['dashboard.sort.moveDown']],
    ],
    [
      'a nested list that admits no known type',
      [stored('Shelf', 'Rise', [hero('Dusk')])],
      ['Shelf'],
      'Rise',
      [{ $key: 'Shelf' }],
      [`${ADD}, dashboard.duplicate | ${CLIP}, ${PASTE} | dashboard.delete`, []],
    ],
    [
      'a row with several nested lists',
      [{ block: 'Duo', fields: { title: 'Rise', left: [], right: [] } }],
      ['Duo', 'Hero'],
      'Rise',
      [{ $key: 'Hero' }],
      [`${ALONE.replace(' | dashboard.delete', '')}, ${PASTE} | dashboard.delete`, []],
    ],
  ];

  for (const [name, blocks, allow, title, clipboard, expected] of cases) {
    it(`renders ${name}`, () => {
      const { row } = mountTree(blocks, { allow });
      if (clipboard !== null) {
        clipboardData.value = {
          ohneClipboardDataType: 'blocks',
          data: clipboard as { $key: string }[],
        };
      }
      deepStrictEqual(rightMenu(row(title)), expected);
    });
  }

  it('names the hotkeys of a row selected alone, paste among them', async () => {
    const { tree, list, row } = mountTree(['Fall', 'Rise']);
    clipboardData.value = { ohneClipboardDataType: 'blocks', data: [{ $key: 'Hero' }] };
    tree.select([list.nodes()[0]!.$key]);
    await settled();
    deepStrictEqual(rightMenu(row('Fall')), [
      `${ADD}, dashboard.duplicate[duplicate]` +
        ', dashboard.sort.moveUp[moveUp], dashboard.sort.moveDown[moveDown]' +
        ' | dashboard.clipboard.copy[copy], dashboard.clipboard.cut[cut]' +
        ', dashboard.clipboard.pasteBefore, dashboard.clipboard.pasteAfter[paste]' +
        ' | dashboard.delete[delete]',
      ['dashboard.sort.moveUp'],
    ]);
  });

  it('acts on the whole selection when the row is in it, without the rows for one block', async () => {
    const { tree, list, row } = mountTree(['Fall', 'Rise', 'Wrath', 'Dusk']);
    const [fall, rise, wrath, dusk] = list.nodes();
    clipboardData.value = { ohneClipboardDataType: 'blocks', data: [{ $key: 'Hero' }] };
    tree.select([fall!.$key, rise!.$key, wrath!.$key]);
    await settled();
    deepStrictEqual(rightMenu(row('Fall')), [
      'dashboard.duplicate[duplicate], dashboard.sort.moveUp[moveUp], dashboard.sort.moveDown[moveDown]' +
        ' | dashboard.clipboard.copy[copy], dashboard.clipboard.cut[cut] | Delete 3 blocks[delete]',
      ['dashboard.sort.moveUp'],
    ]);
    fire(rowNamed(menus().at(-1)!, 'Delete 3 blocks'), 'click', {});
    await settled();
    deepStrictEqual([menus(), list.nodes()], [[], [dusk]]);
  });

  it('counts a selected block and its selected child as one target', async () => {
    const { tree, list, row } = mountTree([stored('Group', 'Rise', [hero('Dusk')]), hero('Fall')], {
      allow: ['Hero', 'Group'],
    });
    const [group, fall] = list.nodes();
    const [dusk] = blocksHandleOf(group!.form.controlOf('items'))!.nodes();
    tree.select([group!.$key, dusk!.$key, fall!.$key]);
    await settled();
    const [shape] = rightMenu(row('Rise'));
    strictEqual(shape.endsWith(' | Delete 2 blocks[delete]'), true);
  });

  it('offers the rows for one block on a selected block and its selected child', async () => {
    const { tree, list, row } = mountTree([stored('Group', 'Rise', [hero('Dusk')]), hero('Fall')], {
      allow: ['Hero', 'Group'],
    });
    const [group] = list.nodes();
    const [dusk] = blocksHandleOf(group!.form.controlOf('items'))!.nodes();
    tree.select([group!.$key, dusk!.$key]);
    await settled();
    const [shape] = rightMenu(row('Rise'));
    deepStrictEqual(
      [shape.startsWith('dashboard.sort.addBefore'), shape.endsWith(' | dashboard.delete[delete]')],
      [true, true],
    );
  });

  it('hides Duplicate on a selection holding a type its list no longer offers', async () => {
    const { tree, list, row } = mountTree([
      hero('Fall'),
      stored('Shelf', 'Rise', [hero('Dusk')]),
      hero('Wrath'),
    ]);
    const [fall, rise] = list.nodes();
    tree.select([fall!.$key, rise!.$key]);
    await settled();
    deepStrictEqual(rightMenu(row('Fall')), [
      'dashboard.sort.moveUp[moveUp], dashboard.sort.moveDown[moveDown]' +
        ' | dashboard.clipboard.copy[copy], dashboard.clipboard.cut[cut] | Delete 2 blocks[delete]',
      ['dashboard.sort.moveUp'],
    ]);
  });

  it('hides both moves on a selection that cannot move', async () => {
    const { tree, list, row } = mountTree(['Fall', 'Rise']);
    tree.select(list.nodes().map((node) => node.$key));
    await settled();
    deepStrictEqual(rightMenu(row('Fall')), [
      'dashboard.duplicate[duplicate]' +
        ' | dashboard.clipboard.copy[copy], dashboard.clipboard.cut[cut] | Delete 2 blocks[delete]',
      [],
    ]);
  });

  it('marks Delete destructive with the `trash-x` icon', () => {
    const { row } = mountTree(['Fall']);
    rightClick(row());
    const remove = rowNamed(menus()[0]!, 'dashboard.delete');
    deepStrictEqual(
      [
        hasClass(remove, 'ohne-dropdown-item-destructive'),
        (findElement(remove, (node) => node.tagName === 'SVG') as unknown as SVGSVGElement)
          .innerHTML === icon('trash-x').innerHTML,
      ],
      [true, true],
    );
  });

  it('leaves a locked list to the browser menu, with no kebab', () => {
    const { row } = mountTree(['Fall'], { disabled: true });
    const event = rightClick(row());
    const dots = findElement(
      row(),
      (node) => node.getAttribute('aria-label') === 'dashboard.record.moreActions',
    );
    deepStrictEqual([event.defaultPrevented, menus(), dots], [false, [], undefined]);
  });

  it('leaves a slot row to the browser menu', () => {
    const { row } = mountTree([{ block: 'Duo', fields: { title: 'Rise', left: [], right: [] } }], {
      allow: ['Duo'],
    });
    const event = rightClick(row('left'));
    deepStrictEqual([event.defaultPrevented, menus()], [false, []]);
  });

  it('acts on a row outside the selection alone, and keeps the selection', async () => {
    const { tree, list, row } = mountTree(['Fall', 'Rise', 'Wrath']);
    const [, rise, wrath] = list.nodes();
    tree.select([rise!.$key, wrath!.$key]);
    await settled();
    rightClick(row('Fall'));
    fire(rowNamed(menus()[0]!, 'dashboard.delete'), 'click', {});
    await settled();
    deepStrictEqual(
      [list.nodes().map((node) => node.$key), tree.selected().map((node) => node.$key)],
      [
        [rise!.$key, wrath!.$key],
        [rise!.$key, wrath!.$key],
      ],
    );
  });

  it('keeps focus in the tree, on the selection, after the menu deletes its own row', async () => {
    const { tree, list, row } = mountTree(['Fall', 'Rise']);
    const [, rise] = list.nodes();
    tree.select([rise!.$key]);
    await settled();
    rightClick(row('Fall'));
    fire(rowNamed(menus()[0]!, 'dashboard.delete'), 'click', {});
    await settled();
    await new Promise((resolve) => setTimeout(resolve));
    const focused = document.activeElement as unknown as FakeElement;
    deepStrictEqual(
      [hasClass(focused, 'ohne-tree-item-button-selected'), focused.textContent.includes('Rise')],
      [true, true],
    );
  });

  it('opens and picks from the kebab without changing the selection', async () => {
    const { tree, list, row } = mountTree(['Fall', 'Rise', 'Wrath']);
    const [, rise] = list.nodes();
    tree.select([rise!.$key]);
    await settled();
    const pathOf = (element: FakeElement): FakeElement[] => {
      const path: FakeElement[] = [];
      for (let node: FakeElement | null = element; node; node = node.parentElement) path.push(node);
      return path;
    };
    const dots = findElement(
      row('Fall'),
      (node) => node.getAttribute('aria-label') === 'dashboard.record.moreActions',
    )!;
    bubble(pathOf(dots), 'click');
    flush();
    const kebab = findElement(row('Fall'), (node) => node.getAttribute('role') === 'menu')!;
    const selection = (): number[] => tree.selected().map((node) => node.$key);
    const opened = selection();
    bubble(pathOf(rowNamed(kebab, 'dashboard.clipboard.copy')), 'click');
    await settled();
    deepStrictEqual([opened, selection()], [[rise!.$key], [rise!.$key]]);
  });

  it('shows the same rows in the kebab, a ghost trigger while open', () => {
    const { row } = mountTree(['Fall']);
    const dots = findElement(
      row(),
      (node) => node.getAttribute('aria-label') === 'dashboard.record.moreActions',
    )!;
    const state = (): unknown[] => [
      dots.getAttribute('aria-haspopup'),
      dots.getAttribute('aria-expanded'),
      hasClass(dots, 'ohne-button-ghost'),
      dots.classList.has('ohne-button-primary'),
    ];
    deepStrictEqual(state(), ['menu', 'false', true, false]);
    fire(dots, 'click', {});
    flush();
    const kebab = findElement(row(), (node) => node.getAttribute('role') === 'menu')!;
    deepStrictEqual(
      [state(), menuOf(kebab)],
      [
        ['menu', 'true', true, false],
        [ALONE, []],
      ],
    );
  });
});
