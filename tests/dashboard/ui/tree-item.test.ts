import { strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import type { TreeItemModel } from '../../../src/dashboard/ui/tree-model.ts';

import { ref } from '../../../src/utils/reactive/ref.ts';
import { type FakeElement, findElement, hasClass } from '../_fake-dom.ts';
import { fire } from './_events.ts';

const { treeItem } = await import('../../../src/dashboard/ui/tree-item.ts');

const touchAt = (clientX: number, clientY: number): Record<string, unknown> => ({
  touches: [{ clientX, clientY }],
});

const mount = (): { button: FakeElement; isTouchDragging: { value: boolean } } => {
  const item: TreeItemModel<null> = {
    id: 'a',
    source: null,
    label: 'A',
    nestable: false,
    draggable: true,
  };
  const model = { item, index: 0, parents: [], descendants: [] };
  const isTouchDragging = ref(false);
  const root = treeItem({
    model: () => model,
    tree: () => [item],
    activeItems: () => [model],
    activeIndex: () => 0,
    selectedItems: () => [],
    selectedItemIds: () => ({}),
    selectionOrigin: ref(null),
    isDragging: ref(false),
    isTouchDragging,
    dropTarget: ref(null),
    mousePaused: ref(false),
    onHighlight() {},
    onSelect() {},
    onDrop() {},
    onFocusPrevious() {},
    onFocusNext() {},
    onTreeUpdate() {},
  }) as unknown as FakeElement;
  const button = findElement(root, (element) => hasClass(element, 'ohne-tree-item-button'))!;
  return { button, isTouchDragging };
};

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
});
