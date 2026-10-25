import { deepStrictEqual, strictEqual } from 'node:assert';
import { afterEach, describe, it } from 'node:test';

import type { MenuGroup } from '../../../src/dashboard/ui/menu.ts';
import type { TreeItemModel } from '../../../src/dashboard/ui/tree-model.ts';

import { effectScope } from '../../../src/utils/reactive/effect-scope.ts';
import { ref } from '../../../src/utils/reactive/ref.ts';
import { FakeElement, findElement, hasClass } from '../_fake-dom.ts';
import { fire, matchSelectors } from './_events.ts';

const { treeItem } = await import('../../../src/dashboard/ui/tree-item.ts');

const touchAt = (clientX: number, clientY: number): Record<string, unknown> => ({
  touches: [{ clientX, clientY }],
});

const body = (): FakeElement => document.body as unknown as FakeElement;
const panels = (): FakeElement[] =>
  body().childNodes.filter(
    (node): node is FakeElement =>
      node instanceof FakeElement && node.getAttribute('role') === 'menu',
  );

const row = (id: string): TreeItemModel<null> => ({
  id,
  source: null,
  label: id.toUpperCase(),
  nestable: false,
  draggable: true,
});

const [A, B, C] = [row('a'), row('b'), row('c')];
const mounts: (() => void)[] = [];

matchSelectors();
Object.assign(window, {
  getSelection: () => ({ isCollapsed: true, containsNode: () => false, removeAllRanges() {} }),
});

afterEach(() => {
  for (const dispose of mounts.splice(0)) dispose();
});

/**
 * Mounts the row of `A` in the tree `[A, B, C]` with `selected` picked, and records each new selection.
 */
const mount = (
  options: {
    selected?: TreeItemModel<null>[];
    origin?: TreeItemModel<null>;
    menu?: (item: TreeItemModel<null>) => readonly MenuGroup[];
  } = {},
): {
  button: FakeElement;
  isTouchDragging: { value: boolean };
  selected: { value: TreeItemModel<null>[] };
  selections: string[][];
} => {
  const models = [A, B, C].map((item, index) => ({ item, index, parents: [], descendants: [] }));
  const selected = ref(options.selected ?? []);
  const selections: string[][] = [];
  const isTouchDragging = ref(false);
  const scope = effectScope(true);
  const root = scope.run(() =>
    treeItem({
      model: () => models[0]!,
      tree: () => [A, B, C],
      activeItems: () => models,
      activeIndex: () => 0,
      selectedItems: () => selected.value,
      selectedItemIds: () => Object.fromEntries(selected.value.map(({ id }) => [id, true])),
      selectionOrigin: ref(options.origin ?? null),
      isDragging: ref(false),
      isTouchDragging,
      dropTarget: ref(null),
      mousePaused: ref(false),
      menu: options.menu,
      onHighlight() {},
      onSelect(items) {
        selections.push(items.map(({ id }) => String(id)));
        selected.value = items;
      },
      onDrop() {},
      onFocusPrevious() {},
      onFocusNext() {},
      onTreeUpdate() {},
    }),
  ) as unknown as FakeElement;
  body().appendChild(root);
  mounts.push(() => {
    scope.dispose();
    root.remove();
  });
  const button = findElement(root, (element) => hasClass(element, 'ohne-tree-item-button'))!;
  return { button, isTouchDragging, selected, selections };
};

const rightClick = (target: FakeElement, init: Record<string, unknown> = {}) =>
  fire(target, 'contextmenu', { target, clientX: 120, clientY: 80, ...init });

describe('treeItem', () => {
  it('starts a touch drag on a still hold', (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const { button, isTouchDragging } = mount();
    fire(button, 'touchstart', touchAt(0, 0));
    fire(button, 'touchmove', touchAt(3, 3));
    t.mock.timers.tick(500);
    strictEqual(isTouchDragging.value, true);
  });

  it('leaves a scroll alone, however slow', (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const { button, isTouchDragging } = mount();
    fire(button, 'touchstart', touchAt(0, 0));
    fire(button, 'touchmove', touchAt(0, -12));
    t.mock.timers.tick(750);
    strictEqual(isTouchDragging.value, false);
  });

  it('keeps a held drag from scrolling, so its release lands on a zone', (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const { button } = mount();
    fire(button, 'touchstart', touchAt(0, 0));
    t.mock.timers.tick(500);
    strictEqual(fire(button, 'touchmove', touchAt(0, 40)).defaultPrevented, true);
  });

  it('drops the hold on a cancelled touch', (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const { button, isTouchDragging } = mount();
    fire(button, 'touchstart', touchAt(0, 0));
    fire(button, 'touchcancel');
    t.mock.timers.tick(500);
    strictEqual(isTouchDragging.value, false);
  });

  it('selects an unselected row alone on a right-click, and holds back the browser menu', () => {
    const { button, selections } = mount({ selected: [B, C] });
    strictEqual(rightClick(button).defaultPrevented, true);
    deepStrictEqual(selections, [['a']]);
  });

  it('selects an unselected row alone on a right-click with Shift, as Shift+F10 sends', () => {
    const { button, selections } = mount({ selected: [C], origin: C });
    rightClick(button, { shiftKey: true });
    deepStrictEqual(selections, [['a']]);
  });

  it('keeps the whole selection on a right-click of a row in it', () => {
    const { button, selections } = mount({ selected: [A, B] });
    strictEqual(rightClick(button).defaultPrevented, true);
    deepStrictEqual(selections, []);
  });
});

describe('treeItem menu', () => {
  it('opens the menu on a right-click, leaving the selection as it is', () => {
    const reads: string[][] = [];
    const { button, selected, selections } = mount({
      selected: [B],
      menu: (item) => {
        reads.push([String(item.id), ...selected.value.map(({ id }) => String(id))]);
        return [[{ label: 'Rename' }], [{ label: 'Delete', destructive: true }]];
      },
    });
    const event = rightClick(button);
    deepStrictEqual(
      [event.defaultPrevented, selections, reads, panels().map((panel) => panel.textContent)],
      [true, [], [['a', 'b']], ['RenameDelete']],
    );
  });

  it('leaves the selection as it is when the context-menu key opens the menu', () => {
    const reads: string[][] = [];
    const { button, selections } = mount({
      selected: [B, C],
      menu: (item) => {
        reads.push([String(item.id)]);
        return [[{ label: 'Rename' }]];
      },
    });
    const press = fire(button, 'keydown', { target: button, key: 'ContextMenu' });
    deepStrictEqual(
      [press.defaultPrevented, selections, reads, panels().length],
      [true, [], [['a']], 1],
    );
  });

  it('leaves the browser menu on a button inside the row and on an empty list', () => {
    const { button } = mount({ menu: () => [[{ label: 'Rename' }]] });
    const inner = document.createElement('button') as unknown as FakeElement;
    button.appendChild(inner);
    deepStrictEqual(
      [rightClick(button, { target: inner }).defaultPrevented, panels()],
      [false, []],
    );
    mounts.splice(0).forEach((dispose) => dispose());
    const empty = mount({ menu: () => [] });
    deepStrictEqual([rightClick(empty.button).defaultPrevented, panels()], [false, []]);
  });

  it('starts a drag on a touch hold rather than opening the menu', (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const { button, isTouchDragging } = mount({ menu: () => [[{ label: 'Rename' }]] });
    fire(button, 'touchstart', { ...touchAt(0, 0), target: button });
    t.mock.timers.tick(500);
    deepStrictEqual([isTouchDragging.value, panels()], [true, []]);
  });

  it('closes its menu with the row', () => {
    const { button } = mount({ menu: () => [[{ label: 'Rename' }]] });
    rightClick(button);
    strictEqual(panels().length, 1);
    mounts.splice(0).forEach((dispose) => dispose());
    deepStrictEqual(panels(), []);
  });
});
