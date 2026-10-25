import { deepStrictEqual, strictEqual } from 'node:assert';
import { afterEach, beforeEach, describe, it, mock } from 'node:test';

import type { ContextMenuOptions } from '../../../src/dashboard/ui/context-menu.ts';
import type { MenuGroup } from '../../../src/dashboard/ui/menu.ts';
import type { MaybeGetter } from '../../../src/utils/reactive/to-value.ts';

import { effectScope } from '../../../src/utils/reactive/effect-scope.ts';
import { FakeElement, findElement, hasClass } from '../_fake-dom.ts';
import { bubble, fire, matchSelectors, trackRowFocus } from './_events.ts';
import { shapeOfDOM } from './_menu-shape.ts';

const { contextMenu } = await import('../../../src/dashboard/ui/context-menu.ts');
const { dropdown } = await import('../../../src/dashboard/ui/dropdown.ts');
const { dropdownItem } = await import('../../../src/dashboard/ui/dropdown-item.ts');

const body = (): FakeElement => document.body as unknown as FakeElement;
const element = (tag = 'div'): FakeElement => document.createElement(tag) as unknown as FakeElement;
const panels = (root: FakeElement = body()): FakeElement[] =>
  root.childNodes.filter(
    (node): node is FakeElement =>
      node instanceof FakeElement && node.getAttribute('role') === 'menu',
  );
const row = (panel: FakeElement, text: string): FakeElement =>
  findElement(
    panel,
    (node) => node.getAttribute('role') === 'menuitem' && node.textContent === text,
  )!;

const settled = async (): Promise<void> => {
  await new Promise((resolve) => setTimeout(resolve));
  await new Promise((resolve) => setTimeout(resolve));
};

const RAID: MenuGroup[] = [
  [{ label: 'Summon', icon: 'wand' }],
  [{ label: 'Kick from raid', destructive: true }],
];

let selection: { isCollapsed: boolean; containsNode(node: unknown): boolean } = {
  isCollapsed: true,
  containsNode: () => false,
};
const mounts: (() => void)[] = [];

/**
 * A target spanning (40, 20) to (440, 320) on the body, wired to a context menu of `groups`.
 */
function attach(
  groups: MaybeGetter<readonly MenuGroup[]> = RAID,
  options?: ContextMenuOptions,
  parent: FakeElement = body(),
): FakeElement {
  const target = element();
  Object.assign(target, {
    getBoundingClientRect: () => ({
      x: 40,
      y: 20,
      width: 400,
      height: 300,
      left: 40,
      top: 20,
      right: 440,
      bottom: 320,
    }),
  });
  parent.appendChild(target);
  const scope = effectScope(true);
  scope.run(() => contextMenu(target as unknown as HTMLElement, groups, options));
  mounts.push(() => {
    scope.dispose();
    target.remove();
  });
  return target;
}

/**
 * Lays out the open panel as 200 by 100 pixels, and waits until it listens for keys and presses.
 */
async function laidOut(panel: FakeElement): Promise<FakeElement> {
  Object.defineProperties(panel, { offsetWidth: { value: 200 }, offsetHeight: { value: 100 } });
  await settled();
  return panel;
}

Object.assign(document.documentElement, { clientWidth: 1000, clientHeight: 800 });
Object.assign(window, { getSelection: () => ({ ...selection, removeAllRanges() {} }) });
matchSelectors();
trackRowFocus();

afterEach(() => {
  for (const dispose of mounts.splice(0)) dispose();
  selection = { isCollapsed: true, containsNode: () => false };
});

describe('contextMenu', () => {
  it('opens its rows at the pointer on a right-click, and claims the event', async () => {
    const target = attach();
    const event = fire(target, 'contextmenu', { target, clientX: 120, clientY: 80 });
    const [panel] = panels();
    deepStrictEqual(
      [event.defaultPrevented, event.propagationStopped, panel?.textContent],
      [true, true, 'SummonKick from raid'],
    );
    await laidOut(panel!);
    deepStrictEqual([panel!.style.left, panel!.style.top], ['120px', '80px']);
    strictEqual(document.activeElement, panel);
  });

  it('reads its groups on each open', () => {
    let reads = 0;
    const target = attach(() => {
      reads += 1;
      return RAID;
    });
    strictEqual(reads, 0);
    fire(target, 'contextmenu', { target, clientX: 120, clientY: 80 });
    strictEqual(reads, 1);
  });

  it('drops skipped rows and empty groups, with one divider between the groups left', () => {
    const target = attach([
      [],
      [{ label: 'Summon' }, false],
      [undefined],
      [{ label: 'Ready check', hotkey: 'duplicate' }],
      [],
    ]);
    fire(target, 'contextmenu', { target, clientX: 120, clientY: 80 });
    strictEqual(shapeOfDOM(panels()[0]!), 'Summon | Ready check[duplicate]');
  });

  it('closes before it runs the picked action', () => {
    const calls: string[] = [];
    const target = attach([
      [{ label: 'Summon', onSelect: () => calls.push(panels().length ? 'open' : 'closed') }],
    ]);
    fire(target, 'contextmenu', { target, clientX: 120, clientY: 80 });
    fire(row(panels()[0]!, 'Summon'), 'click');
    deepStrictEqual(calls, ['closed']);
  });

  it('marks its target while the menu is open', () => {
    const target = attach();
    const marked = (): boolean => target.getAttribute('data-ohne-context-menu-open') !== null;
    strictEqual(marked(), false);
    fire(target, 'contextmenu', { target, clientX: 120, clientY: 80 });
    strictEqual(marked(), true);
    fire(row(panels()[0]!, 'Summon'), 'click');
    strictEqual(marked(), false);
  });

  it('keeps the mark through a reactive class binding that rewrites the class list', () => {
    const target = attach();
    fire(target, 'contextmenu', { target, clientX: 120, clientY: 80 });
    target.classList.clear();
    target.setAttribute('class', 'ohne-tree-item-selected');
    strictEqual(target.getAttribute('data-ohne-context-menu-open'), '');
  });

  it('opens below the target, at its first enabled row, when the keyboard reports no point', async () => {
    const target = attach([[{ label: 'Summon', disabled: () => true }, { label: 'Ready check' }]]);
    fire(target, 'contextmenu', { target, clientX: 0, clientY: 0 });
    const panel = await laidOut(panels()[0]!);
    deepStrictEqual(
      [panel.style.left, panel.style.top, document.activeElement],
      ['40px', '324px', row(panel, 'Ready check')],
    );
  });

  it('opens below the target, at its first enabled row, on the context-menu key and Shift+F10', async () => {
    for (const keys of [{ key: 'ContextMenu' }, { key: 'F10', shiftKey: true }]) {
      const target = attach([
        [{ label: 'Summon', disabled: () => true }, { label: 'Ready check' }],
      ]);
      const press = fire(target, 'keydown', { target, ...keys });
      const panel = await laidOut(panels()[0]!);
      deepStrictEqual(
        [press.defaultPrevented, press.propagationStopped, panel.style.left, panel.style.top],
        [true, true, '40px', '324px'],
      );
      strictEqual(document.activeElement, row(panel, 'Ready check'));
      const centered = fire(target, 'contextmenu', { target, clientX: 240, clientY: 170 });
      deepStrictEqual(
        [centered.defaultPrevented, centered.propagationStopped, panels()],
        [true, true, [panel]],
      );
      mounts.pop()!();
    }
  });

  it('leaves F10 alone, and the keys pressed on an ignored element, to the browser', () => {
    const target = attach();
    const input = element('input');
    target.appendChild(input);
    const plain = fire(target, 'keydown', { target, key: 'F10' });
    const inside = fire(input, 'keydown', { target: input, key: 'ContextMenu' });
    deepStrictEqual(
      [plain.defaultPrevented, inside.defaultPrevented, panels().length],
      [false, false, 0],
    );
  });

  it('forgets the key once its menu closes, so the next contextmenu stands on its own', async () => {
    const target = attach();
    const input = element('input');
    target.appendChild(input);
    fire(target, 'keydown', { target, key: 'ContextMenu' });
    fire(row(panels()[0]!, 'Summon'), 'click');
    const native = fire(input, 'contextmenu', { target: input, clientX: 0, clientY: 0 });
    fire(target, 'contextmenu', { target, clientX: 240, clientY: 170 });
    const panel = await laidOut(panels()[0]!);
    deepStrictEqual(
      [native.defaultPrevented, panel.style.left, panel.style.top],
      [false, '240px', '170px'],
    );
  });

  it('opens below a target low on the screen whenever the menu fits there', async () => {
    const target = attach();
    Object.assign(target, {
      getBoundingClientRect: () => ({
        x: 40,
        y: 500,
        width: 400,
        height: 60,
        left: 40,
        top: 500,
        right: 440,
        bottom: 560,
      }),
    });
    fire(target, 'keydown', { target, key: 'ContextMenu' });
    const panel = await laidOut(panels()[0]!);
    deepStrictEqual([panel.style.left, panel.style.top], ['40px', '564px']);
  });

  it('opens below the target when the keyboard reports a point outside it', async () => {
    const target = attach();
    fire(target, 'contextmenu', { target, clientX: 600, clientY: 500 });
    const panel = await laidOut(panels()[0]!);
    deepStrictEqual([panel.style.left, panel.style.top], ['40px', '324px']);
  });

  it('opens at the pointer on the left and top edge pixels, which lie inside the target', async () => {
    for (const [clientX, clientY] of [
      [40, 100],
      [100, 20],
    ] as const) {
      const target = attach();
      fire(target, 'contextmenu', { target, clientX, clientY });
      const panel = await laidOut(panels()[0]!);
      deepStrictEqual(
        [panel.style.left, panel.style.top, document.activeElement],
        [`${clientX}px`, `${clientY}px`, panel],
      );
      mounts.pop()!();
    }
  });

  it('opens from the keyboard even when the open reports Shift, as Shift+F10 can', () => {
    const target = attach();
    const event = fire(target, 'contextmenu', { target, clientX: 0, clientY: 0, shiftKey: true });
    deepStrictEqual([event.defaultPrevented, panels().length], [true, 1]);
  });

  it('leaves a Shift right-click to the browser', () => {
    const target = attach();
    const event = fire(target, 'contextmenu', {
      target,
      clientX: 120,
      clientY: 80,
      shiftKey: true,
    });
    deepStrictEqual(
      [event.defaultPrevented, event.propagationStopped, panels().length],
      [false, false, 0],
    );
  });

  it('leaves a right-click to the browser while text inside the target is selected', () => {
    const target = attach();
    selection = { isCollapsed: false, containsNode: (node) => node === target };
    const event = fire(target, 'contextmenu', { target, clientX: 120, clientY: 80 });
    deepStrictEqual([event.defaultPrevented, panels().length], [false, 0]);
  });

  it('opens while the selected text lies elsewhere', () => {
    const target = attach();
    selection = { isCollapsed: false, containsNode: () => false };
    fire(target, 'contextmenu', { target, clientX: 120, clientY: 80 });
    strictEqual(panels().length, 1);
  });

  it('leaves a right-click on an ignored element inside the target to the browser', () => {
    const target = attach(RAID, { ignore: '.ohne-raw-link' });
    const link = element('a');
    link.setAttribute('class', 'ohne-raw-link');
    target.appendChild(link);
    const event = fire(target, 'contextmenu', { target: link, clientX: 120, clientY: 80 });
    deepStrictEqual([event.defaultPrevented, panels().length], [false, 0]);
  });

  it('leaves links, buttons, fields, labels and editable text inside the target to the browser', () => {
    const target = attach();
    const opened = ['a', 'button', 'input', 'label', 'span'].map((tag) => {
      const hit = element(tag);
      if (tag === 'a') hit.setAttribute('href', '/raid');
      if (tag === 'span') hit.setAttribute('contenteditable', 'true');
      target.appendChild(hit);
      return fire(target, 'contextmenu', { target: hit, clientX: 120, clientY: 80 })
        .defaultPrevented;
    });
    const anchor = element('a');
    target.appendChild(anchor);
    fire(target, 'contextmenu', { target: anchor, clientX: 120, clientY: 80 });
    deepStrictEqual([opened, panels().length], [[false, false, false, false, false], 1]);
  });

  it('opens on a target that matches `ignore` itself', () => {
    const target = attach(RAID, { ignore: '.ohne-raw-link' });
    target.setAttribute('class', 'ohne-raw-link');
    fire(target, 'contextmenu', { target, clientX: 120, clientY: 80 });
    strictEqual(panels().length, 1);
  });

  it('leaves a right-click to the browser when no action row is left', () => {
    for (const groups of [[], [[]], [[false, undefined], []]] satisfies MenuGroup[][]) {
      const target = attach(groups);
      const event = fire(target, 'contextmenu', { target, clientX: 120, clientY: 80 });
      deepStrictEqual([event.defaultPrevented, panels().length], [false, 0]);
    }
  });

  it('opens one menu, the innermost, from nested targets', () => {
    const outer = attach([[{ label: 'Disband raid' }]]);
    const inner = attach([[{ label: 'Summon' }]], {}, outer);
    bubble([inner, outer], 'contextmenu', { target: inner, clientX: 120, clientY: 80 });
    deepStrictEqual(
      panels().map((panel) => panel.textContent),
      ['Summon'],
    );
  });

  it('opens no second menu on a right-click inside a dropdown that the target hosts', async () => {
    const target = attach();
    const scope = effectScope(true);
    let kebab!: FakeElement;
    scope.run(() => {
      kebab = dropdown(dropdownItem('Duplicate')).root as unknown as FakeElement;
      target.appendChild(kebab);
    });
    await settled();
    const inside = findElement(kebab, (node) => hasClass(node, 'ohne-dropdown-inner'))!;
    bubble([inside, kebab, target, body()], 'contextmenu', {
      target: inside,
      clientX: 600,
      clientY: 500,
    });
    strictEqual(panels().length, 0);
    scope.dispose();
  });

  it('closes on a second right-click and keeps the browser menu shut', async () => {
    const target = attach();
    fire(target, 'contextmenu', { target, clientX: 120, clientY: 80 });
    await laidOut(panels()[0]!);
    const second = fire(body(), 'contextmenu', { target: body(), clientX: 300, clientY: 200 });
    deepStrictEqual([second.defaultPrevented, panels().length], [true, 0]);
  });

  it('keeps its keys inside a popup after the pointer leaves a row', async () => {
    const popup = element();
    popup.classList.add('ohne-popup');
    body().appendChild(popup);
    const target = attach(RAID, {}, popup);
    fire(target, 'contextmenu', { target, clientX: 120, clientY: 80 });
    const panel = await laidOut(panels(popup)[0]!);
    fire(row(panel, 'Summon'), 'mouseleave');
    const focusedPopup = document.activeElement;
    const down = fire(popup, 'keydown', { key: 'ArrowDown', code: 'ArrowDown' });
    const focusedRow = document.activeElement;
    const escape = fire(popup, 'keydown', { key: 'Escape', code: 'Escape' });
    deepStrictEqual(
      [focusedPopup, focusedRow, down.defaultPrevented, escape.propagationStopped],
      [popup, row(panel, 'Summon'), true, true],
    );
    strictEqual(panels(popup).length, 0);
    popup.remove();
  });

  it('closes when its scope ends, and stops listening', () => {
    const target = attach();
    fire(target, 'contextmenu', { target, clientX: 120, clientY: 80 });
    mounts.pop()!();
    const event = fire(target, 'contextmenu', { target, clientX: 120, clientY: 80 });
    deepStrictEqual([panels().length, event.defaultPrevented], [0, false]);
  });
});

describe('contextMenu long-press', () => {
  beforeEach(() => {
    mock.timers.reset();
    mock.timers.enable({ apis: ['setTimeout'] });
  });

  afterEach(() => mock.timers.reset());

  /**
   * A touch surface on a fresh target: a finger lands on the target's child.
   */
  function touchSurface(options?: ContextMenuOptions) {
    const target = attach(RAID, options);
    const finger = element('span');
    target.appendChild(finger);
    return {
      target,
      finger,
      down: (touches = [{ clientX: 60, clientY: 30 }]) =>
        fire(target, 'touchstart', { target: finger, touches }),
      move: (clientX: number, clientY: number) =>
        fire(finger, 'touchmove', { touches: [{ clientX, clientY }] }),
      up: () => fire(target, 'touchend', { touches: [] }),
    };
  }

  it('opens at the finger on a still hold and swallows the release click', async () => {
    const s = touchSurface();
    s.down();
    mock.timers.tick(500);
    const [panel] = panels();
    Object.defineProperties(panel!, { offsetWidth: { value: 200 }, offsetHeight: { value: 100 } });
    await Promise.resolve();
    deepStrictEqual([panel!.style.left, panel!.style.top], ['60px', '30px']);
    strictEqual(s.up().defaultPrevented, true);
  });

  it('keeps the release click of a short tap', () => {
    const s = touchSurface();
    s.down();
    mock.timers.tick(200);
    const end = s.up();
    mock.timers.tick(500);
    deepStrictEqual([panels().length, end.defaultPrevented], [0, false]);
  });

  it('keeps the hold through a jitter within the slop', () => {
    const s = touchSurface();
    s.down();
    s.move(64, 36);
    mock.timers.tick(500);
    strictEqual(panels().length, 1);
  });

  it('drops the hold once the finger scrolls away', () => {
    const s = touchSurface();
    s.down();
    s.move(60, 60);
    mock.timers.tick(500);
    deepStrictEqual([panels().length, s.up().defaultPrevented], [0, false]);
  });

  it('drops the hold on a touchcancel', () => {
    const s = touchSurface();
    s.down();
    fire(s.finger, 'touchcancel');
    mock.timers.tick(500);
    strictEqual(panels().length, 0);
  });

  it('drops the hold when a second finger lands', () => {
    const s = touchSurface();
    s.down();
    s.down([
      { clientX: 60, clientY: 30 },
      { clientX: 110, clientY: 80 },
    ]);
    mock.timers.tick(500);
    strictEqual(panels().length, 0);
  });

  it('swallows a native long-press contextmenu once the hold opened the menu', () => {
    const s = touchSurface();
    s.down();
    mock.timers.tick(500);
    const native = fire(s.target, 'contextmenu', { target: s.finger, clientX: 60, clientY: 30 });
    deepStrictEqual(
      [native.defaultPrevented, native.propagationStopped, panels().length],
      [true, true, 1],
    );
  });

  it('lets a native contextmenu during the hold open the menu once', () => {
    const s = touchSurface();
    s.down();
    mock.timers.tick(200);
    fire(s.target, 'contextmenu', { target: s.finger, clientX: 60, clientY: 30 });
    mock.timers.tick(500);
    strictEqual(panels().length, 1);
    strictEqual(s.up().defaultPrevented, true);
  });

  it('keeps the release click when the hold finds no action row', () => {
    const target = attach([]);
    fire(target, 'touchstart', { target, touches: [{ clientX: 60, clientY: 30 }] });
    mock.timers.tick(500);
    const end = fire(target, 'touchend', { touches: [] });
    deepStrictEqual([panels().length, end.defaultPrevented], [0, false]);
  });

  it('ignores a hold on an ignored element inside the target', () => {
    const s = touchSurface({ ignore: '.ohne-grip' });
    s.finger.setAttribute('class', 'ohne-grip');
    s.down();
    mock.timers.tick(500);
    strictEqual(panels().length, 0);
  });

  it('ignores every hold with `touch` off', () => {
    const s = touchSurface({ touch: false });
    s.down();
    mock.timers.tick(500);
    strictEqual(panels().length, 0);
  });

  it('holds open one menu, the innermost, from nested targets', () => {
    const outer = attach([[{ label: 'Disband raid' }]]);
    const inner = attach([[{ label: 'Summon' }]], {}, outer);
    bubble([inner, outer], 'touchstart', {
      target: inner,
      touches: [{ clientX: 60, clientY: 30 }],
    });
    mock.timers.tick(500);
    deepStrictEqual(
      panels().map((panel) => panel.textContent),
      ['Summon'],
    );
  });
});
