import { deepStrictEqual, strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import type { FieldForm } from '../../../src/dashboard/fields/field-form.ts';
import type { ItemFocus } from '../../../src/dashboard/fields/structure-chrome.ts';

import { flush, nextTick } from '../../../src/utils/reactive/_scheduler.ts';
import { type Ref, ref } from '../../../src/utils/reactive/ref.ts';
import { FakeElement, findElement } from '../_fake-dom.ts';
import { fire } from '../ui/_events.ts';
import { settle, trackFocus } from './_cards.ts';

const { focusAfterRemoval, focusAfterRestore, focusOrigin, structureActions, trackItemFocus } =
  await import('../../../src/dashboard/fields/structure-chrome.ts');

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
 * The menu item titled `title`, a message key while no catalog is loaded, once the dropdown is open.
 */
function menuItem(root: FakeElement, title: string): FakeElement {
  return findElement(root, (el) => (el as unknown as HTMLElement).title === title) as FakeElement;
}

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
    const collapseAll = menuItem(root, 'dashboard.menu.collapseAll');
    (collapseAll as unknown as HTMLElement).focus();
    fire(collapseAll, 'click');
    strictEqual(document.activeElement, dots);
    flush();
    await nextTick();
    deepStrictEqual(picked, ['collapseAll']);
    strictEqual(document.activeElement, dots);
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
