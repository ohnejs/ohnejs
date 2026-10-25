import { deepStrictEqual, strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import type { FieldForm } from '../../../src/dashboard/fields/field-form.ts';
import type {
  ItemFocus,
  StructureMenuOptions,
} from '../../../src/dashboard/fields/structure-chrome.ts';
import type { MenuAction, MenuGroup } from '../../../src/dashboard/ui/menu.ts';

import { compact } from '../../../src/utils/array/compact.ts';
import { flush, nextTick } from '../../../src/utils/reactive/_scheduler.ts';
import { type Ref, ref } from '../../../src/utils/reactive/ref.ts';
import { FakeElement, findElement, hasClass } from '../_fake-dom.ts';
import { fire } from '../ui/_events.ts';
import { shapeOf, shapeOfDOM } from '../ui/_menu-shape.ts';
import { menuRow, settle, trackFocus } from './_cards.ts';

const {
  focusAfterRemoval,
  focusAfterRestore,
  focusOrigin,
  structureActions,
  structureMenu,
  trackItemFocus,
} = await import('../../../src/dashboard/fields/structure-chrome.ts');

trackFocus();

/**
 * The cluster of an item at `at` in a list of `count`, whose moves shift `at` as a list would.
 * Picked collapse-all actions land in `picked`.
 */
function cluster(index: number | Ref<number>, count: number, picked: string[] = []): FakeElement {
  const at = typeof index === 'number' ? ref(index) : index;
  return structureActions({
    index: () => at.value,
    count: () => count,
    expanded: () => true,
    allExpanded: () => true,
    allCollapsed: () => false,
    onToggleExpanded() {},
    onExpandAll() {},
    onCollapseAll() {
      picked.push('collapseAll');
    },
    onMove(delta) {
      at.value += delta;
    },
    copyPayload: () => ({ ohneClipboardDataType: 'blocks', data: [] }),
    canPaste: () => false,
    onPaste() {},
    onDuplicate() {},
    onRemove() {},
  }) as unknown as FakeElement;
}

/**
 * The cluster's button labelled `label`, a message key while no catalog is loaded.
 */
function buttonOf(root: FakeElement, label: string): FakeElement {
  return findElement(root, (el) => el.getAttribute('aria-label') === label) as FakeElement;
}

/**
 * Menu hooks for an item at `at` in a list of three that record each pick in `picked`, with `overrides` on top.
 */
function menuOptions(
  at: () => number,
  picked: string[],
  overrides: Partial<StructureMenuOptions> = {},
): StructureMenuOptions {
  return {
    index: at,
    count: () => 3,
    onMove: (delta) => picked.push(`move ${delta}`),
    allExpanded: () => false,
    allCollapsed: () => false,
    onExpandAll: () => picked.push('expandAll'),
    onCollapseAll: () => picked.push('collapseAll'),
    copyPayload: () => ({ ohneClipboardDataType: 'blocks', data: [] }),
    canPaste: () => false,
    onPaste: (to) => picked.push(`paste ${to}`),
    onDuplicate: () => picked.push('duplicate'),
    onRemove: () => picked.push('remove'),
    ...overrides,
  };
}

/**
 * The action labelled `label` among `items`.
 */
const actionOf = (groups: readonly MenuGroup[], label: string): MenuAction =>
  compact(groups.flat()).find((action) => action.label === label)!;

/**
 * A stand-in item whose form records the focus it takes in `focused`, with an empty focus memory.
 */
function item(
  name: string,
  expanded: boolean,
  focused: string[],
): { $expanded: boolean; form: FieldForm; focus: ItemFocus } {
  return {
    $expanded: expanded,
    form: { focus: () => focused.push(name) } as unknown as FieldForm,
    focus: {},
  };
}

/**
 * A focusable stand-in element under `document.body`, so it reads as connected.
 */
function connected(): FakeElement {
  const element = new FakeElement('input');
  (document.body as unknown as FakeElement).appendChild(element);
  return element;
}

const fallback = (): FakeElement => new FakeElement('button');

/**
 * Focuses `button` and clicks it, as a pointer or the keyboard does, then lets the move settle.
 */
async function press(button: FakeElement): Promise<void> {
  (button as unknown as HTMLElement).focus();
  fire(button, 'click');
  flush();
  await nextTick();
}

describe('structureActions', () => {
  it('names the expand toggle for assistive tech, following its state', () => {
    const root = cluster(0, 2);
    flush();
    strictEqual(!!buttonOf(root, 'dashboard.menu.collapse'), true);
  });

  it('hands focus to Move up when Move down lands the item last', async () => {
    const root = cluster(0, 2);
    flush();
    await press(buttonOf(root, 'dashboard.sort.moveDown'));
    strictEqual(document.activeElement, buttonOf(root, 'dashboard.sort.moveUp'));
  });

  it('hands focus to Move down when Move up lands the item first', async () => {
    const root = cluster(1, 2);
    flush();
    await press(buttonOf(root, 'dashboard.sort.moveUp'));
    strictEqual(document.activeElement, buttonOf(root, 'dashboard.sort.moveDown'));
  });

  it('keeps focus on the move button while the item stays off the edges', async () => {
    const root = cluster(0, 3);
    flush();
    await press(buttonOf(root, 'dashboard.sort.moveDown'));
    strictEqual(document.activeElement, buttonOf(root, 'dashboard.sort.moveDown'));
  });

  it('hands focus to the sibling when an undo carries the item to the edge', async () => {
    const at = ref(0);
    const root = cluster(at, 2);
    flush();
    (buttonOf(root, 'dashboard.sort.moveDown') as unknown as HTMLElement).focus();
    at.value = 1;
    flush();
    await nextTick();
    strictEqual(document.activeElement, buttonOf(root, 'dashboard.sort.moveUp'));
  });

  it('returns focus to the trigger after a picked action, before the menu closes', async () => {
    const picked: string[] = [];
    const root = cluster(0, 2, picked);
    flush();
    const dots = buttonOf(root, 'dashboard.record.moreActions');
    fire(dots, 'click');
    flush();
    const collapseAll = menuRow(root, 'dashboard.menu.collapseAll');
    (collapseAll as unknown as HTMLElement).focus();
    fire(collapseAll, 'click');
    strictEqual(document.activeElement, dots);
    flush();
    await nextTick();
    deepStrictEqual(picked, ['collapseAll']);
    strictEqual(document.activeElement, dots);
  });

  it('opens its dropdown as a menu, and says so on the trigger', () => {
    const root = cluster(0, 2);
    flush();
    const dots = buttonOf(root, 'dashboard.record.moreActions');
    deepStrictEqual(
      [dots.getAttribute('aria-haspopup'), dots.getAttribute('aria-expanded')],
      ['menu', 'false'],
    );
    fire(dots, 'click');
    flush();
    const panel = findElement(root, (el) => el.getAttribute('role') === 'menu');
    deepStrictEqual([!!panel, dots.getAttribute('aria-expanded')], [true, 'true']);
  });

  it('keeps the trigger ghost while open, for the shared expanded look', () => {
    const root = cluster(0, 2);
    flush();
    const dots = buttonOf(root, 'dashboard.record.moreActions');
    fire(dots, 'click');
    flush();
    deepStrictEqual(
      [hasClass(dots, 'ohne-button-ghost'), dots.classList.has('ohne-button-primary')],
      [true, false],
    );
  });

  it('lists the item actions in its dropdown, the move up off at the top', () => {
    const root = cluster(0, 2);
    flush();
    fire(buttonOf(root, 'dashboard.record.moreActions'), 'click');
    flush();
    const panel = findElement(root, (el) => el.getAttribute('role') === 'menu')!;
    deepStrictEqual(
      [shapeOfDOM(panel), menuRow(panel, 'dashboard.sort.moveUp').getAttribute('aria-disabled')],
      [
        'dashboard.duplicate, dashboard.sort.moveUp, dashboard.sort.moveDown' +
          ' | dashboard.clipboard.copy, dashboard.clipboard.cut' +
          ' | dashboard.menu.collapseAll | dashboard.delete',
        'true',
      ],
    );
  });

  it('moves no focus when the button was not focused', async () => {
    const root = cluster(0, 2);
    flush();
    Object.assign(document, { activeElement: null });
    fire(buttonOf(root, 'dashboard.sort.moveDown'), 'click');
    flush();
    await nextTick();
    strictEqual(document.activeElement, null);
  });
});

describe('structureMenu', () => {
  const ADD = 'dashboard.sort.addBefore, dashboard.sort.addAfter';
  const MOVE = 'dashboard.sort.moveUp, dashboard.sort.moveDown';
  const CLIP = 'dashboard.clipboard.copy, dashboard.clipboard.cut';
  const PASTE = 'dashboard.clipboard.pasteBefore, dashboard.clipboard.pasteAfter';
  const BOTH = 'dashboard.menu.expandAll, dashboard.menu.collapseAll';
  const add = { onAdd() {} };

  const cases: [string, Partial<StructureMenuOptions>, string][] = [
    [
      'a repeater item, mixed expansion, empty clipboard',
      add,
      `${ADD}, dashboard.duplicate, ${MOVE} | ${CLIP} | ${BOTH} | dashboard.delete`,
    ],
    [
      'every item collapsed',
      { ...add, allCollapsed: () => true },
      `${ADD}, dashboard.duplicate, ${MOVE} | ${CLIP} | dashboard.menu.expandAll | dashboard.delete`,
    ],
    [
      'every item expanded',
      { ...add, allExpanded: () => true },
      `${ADD}, dashboard.duplicate, ${MOVE} | ${CLIP} | dashboard.menu.collapseAll | dashboard.delete`,
    ],
    [
      'a pasteable clipboard',
      { ...add, canPaste: () => true },
      `${ADD}, dashboard.duplicate, ${MOVE} | ${CLIP}, ${PASTE} | ${BOTH} | dashboard.delete`,
    ],
    [
      'a block no type is offered for, its own no longer allowed',
      { onDuplicate: undefined, allCollapsed: () => true },
      `${MOVE} | ${CLIP} | dashboard.menu.expandAll | dashboard.delete`,
    ],
    [
      'the only item',
      { ...add, count: () => 1, allExpanded: () => true },
      `${ADD}, dashboard.duplicate | ${CLIP} | dashboard.menu.collapseAll | dashboard.delete`,
    ],
  ];

  for (const [name, overrides, shape] of cases) {
    it(`renders ${name}`, () => {
      strictEqual(shapeOf(structureMenu(menuOptions(() => 1, [], overrides))), shape);
    });
  }

  it('disables only the move that faces an edge', () => {
    const offAt = (at: number): boolean[] => {
      const groups = structureMenu(menuOptions(() => at, []));
      return ['dashboard.sort.moveUp', 'dashboard.sort.moveDown'].map(
        (label) => actionOf(groups, label).disabled?.() ?? false,
      );
    };
    deepStrictEqual(
      [offAt(0), offAt(1), offAt(2)],
      [
        [true, false],
        [false, false],
        [false, true],
      ],
    );
  });

  it('moves the item through `onMove`', async () => {
    const picked: string[] = [];
    const groups = structureMenu(menuOptions(() => 1, picked));
    actionOf(groups, 'dashboard.sort.moveUp').onSelect?.();
    actionOf(groups, 'dashboard.sort.moveDown').onSelect?.();
    await nextTick();
    deepStrictEqual(picked, ['move -1', 'move 1']);
  });

  it('hands focus back to the element focused at open, then runs the pick a tick later', async () => {
    const picked: string[] = [];
    const opener = new FakeElement('input');
    (opener as unknown as HTMLElement).focus();
    const items = structureMenu(menuOptions(() => 1, picked));
    Object.assign(document, { activeElement: null });
    actionOf(items, 'dashboard.duplicate').onSelect?.();
    strictEqual(document.activeElement, opener);
    deepStrictEqual(picked, []);
    await nextTick();
    deepStrictEqual(picked, ['duplicate']);
  });

  it('adds and pastes beside the place the item holds at the pick', async () => {
    const picked: string[] = [];
    const at = ref(1);
    const items = structureMenu(
      menuOptions(() => at.value, picked, {
        onAdd: (to) => picked.push(`add ${to}`),
        canPaste: () => true,
      }),
    );
    at.value = 3;
    for (const label of [
      'dashboard.sort.addBefore',
      'dashboard.sort.addAfter',
      'dashboard.clipboard.pasteBefore',
      'dashboard.clipboard.pasteAfter',
    ]) {
      actionOf(items, label).onSelect?.();
    }
    await nextTick();
    deepStrictEqual(picked, ['add 3', 'add 4', 'paste 3', 'paste 4']);
  });

  it('marks Delete alone destructive, with the `trash-x` icon, and names no hotkey', () => {
    const items = structureMenu(menuOptions(() => 0, [], add));
    const remove = actionOf(items, 'dashboard.delete');
    deepStrictEqual(
      [remove.destructive, remove.icon, actionOf(items, 'dashboard.duplicate').destructive],
      [true, 'trash-x', undefined],
    );
    deepStrictEqual(
      compact(items.flat()).filter((action) => action.hotkey !== undefined),
      [],
    );
  });
});

describe('focusAfterRemoval', () => {
  it('focuses the item now at the removed place, else the one before, else the fallback', () => {
    const focused: string[] = [];
    const list = [item('ashes', true, focused), item('bone', true, focused)];
    const add = item('add', true, focused).form as unknown as HTMLElement;
    focusAfterRemoval(list, 1, add);
    focusAfterRemoval(list, 2, add);
    focusAfterRemoval([], 0, add);
    deepStrictEqual(focused, ['bone', 'bone', 'add']);
  });

  it('passes over a collapsed item, which shows no control', () => {
    const focused: string[] = [];
    const list = [item('ashes', true, focused), item('bone', false, focused)];
    const add = item('add', true, focused).form as unknown as HTMLElement;
    focusAfterRemoval(list, 1, add);
    focusAfterRemoval([item('bone', false, focused)], 0, add);
    deepStrictEqual(focused, ['ashes', 'add']);
  });
});

describe('trackItemFocus', () => {
  it('records what takes focus inside the element, as the held body control too only for a body', () => {
    const focus: ItemFocus = {};
    const body = trackItemFocus(focus, new FakeElement('div') as unknown as HTMLElement, true);
    const actions = trackItemFocus(focus, new FakeElement('span') as unknown as HTMLElement, false);
    const input = new FakeElement('input');
    const button = new FakeElement('button');
    fire(body as unknown as FakeElement, 'focusin', { target: input });
    deepStrictEqual(focus, { last: input, held: input });
    fire(actions as unknown as FakeElement, 'focusin', { target: button });
    deepStrictEqual(focus, { last: button, held: input });
  });
});

describe('focusOrigin', () => {
  it('focuses the element focus came from, and falls into the source item once that element cannot take it', () => {
    const focused: string[] = [];
    const from = new FakeElement('button');
    const source = item('source', true, focused);
    focusOrigin(from as unknown as HTMLElement, source)();
    strictEqual(document.activeElement, from);
    deepStrictEqual(focused, []);
    const hidden = new FakeElement('button');
    Object.assign(hidden, { focus() {} });
    focusOrigin(hidden as unknown as HTMLElement, source)();
    deepStrictEqual(focused, ['source']);
    const held = connected();
    source.focus.held = held as unknown as HTMLElement;
    const back = focusOrigin(hidden as unknown as HTMLElement, source);
    source.focus.held = connected() as unknown as HTMLElement;
    back();
    strictEqual(document.activeElement, held);
  });

  it('prefers the control the source item held over the element focus came from', () => {
    const source = item('source', true, []);
    const held = connected();
    source.focus.held = held as unknown as HTMLElement;
    focusOrigin(new FakeElement('button') as unknown as HTMLElement, source)();
    strictEqual(document.activeElement, held);
    const from = new FakeElement('button');
    focusOrigin(from as unknown as HTMLElement, { ...source, $expanded: false })();
    strictEqual(document.activeElement, from);
  });
});

describe('focusAfterRestore', () => {
  it('focuses into the item a restore brought back, on the control that last held focus', async () => {
    const focused: string[] = [];
    const [a, b] = [item('a', true, focused), item('b', true, focused)];
    focusAfterRestore([a], [a, b], fallback() as unknown as HTMLElement);
    await settle();
    deepStrictEqual(focused, ['b']);
    const held = connected();
    b.focus.held = held as unknown as HTMLElement;
    focusAfterRestore([a], [a, b], fallback() as unknown as HTMLElement);
    await settle();
    strictEqual(document.activeElement, held);
    const c = item('c', false, focused);
    focusAfterRestore([a, b], [a, b, c], fallback() as unknown as HTMLElement);
    await settle();
    deepStrictEqual(focused, ['b']);
  });

  it('settles behind a host that moves focus on the flush tick, on the control held before it', async () => {
    const focused: string[] = [];
    const [a, b] = [item('a', true, focused), item('b', true, focused)];
    const body = trackItemFocus(b.focus, new FakeElement('div') as unknown as HTMLElement, true);
    const held = connected();
    const other = connected();
    b.focus.held = held as unknown as HTMLElement;
    focusAfterRestore([a], [a, b], fallback() as unknown as HTMLElement);
    void nextTick().then(() => {
      (other as unknown as HTMLElement).focus();
      fire(body as unknown as FakeElement, 'focusin', { target: other });
    });
    await settle();
    strictEqual(document.activeElement, held);
  });

  it('returns focus where the dropped item came from, else hands it on as a removal does', async () => {
    const focused: string[] = [];
    const [a, b, c] = [
      item('a', true, focused),
      item('b', true, focused),
      item('c', true, focused),
    ];
    const last = new FakeElement('input');
    const origin = new FakeElement('button');
    c.focus.last = last as unknown as HTMLElement;
    c.focus.origin = () => (origin as unknown as HTMLElement).focus();
    (last as unknown as HTMLElement).focus();
    focusAfterRestore([a, b, c], [a, b], fallback() as unknown as HTMLElement);
    await settle();
    strictEqual(document.activeElement, origin);
    c.focus.origin = undefined;
    (last as unknown as HTMLElement).focus();
    focusAfterRestore([a, b, c], [a, b], fallback() as unknown as HTMLElement);
    await settle();
    deepStrictEqual(focused, ['b']);
    (last as unknown as HTMLElement).focus();
    focusAfterRestore([a, c, b], [a, b], fallback() as unknown as HTMLElement);
    await settle();
    deepStrictEqual(focused, ['b', 'b']);
    (origin as unknown as HTMLElement).focus();
    focusAfterRestore([a, b, c], [a, b], fallback() as unknown as HTMLElement);
    await settle();
    deepStrictEqual(focused, ['b', 'b']);
  });
});
