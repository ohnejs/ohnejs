import { deepStrictEqual, strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import type { MenuGroup } from '../../../src/dashboard/ui/menu.ts';
import type { StructureItemOptions } from '../../../src/dashboard/ui/structure-item.ts';

import { flush } from '../../../src/utils/reactive/_scheduler.ts';
import { effectScope } from '../../../src/utils/reactive/effect-scope.ts';
import { FakeElement, findElement, hasClass } from '../_fake-dom.ts';
import { bubble, fire, matchSelectors } from './_events.ts';

Object.assign(window, { getSelection: () => null });
matchSelectors();

const { structureItem } = await import('../../../src/dashboard/ui/structure-item.ts');

const touchAt = (clientX: number, clientY: number): Record<string, unknown> => ({
  touches: [{ clientX, clientY }],
});

const mount = (overrides: Partial<StructureItemOptions> = {}): FakeElement => {
  let root!: FakeElement;
  effectScope(true).run(() => {
    root = structureItem({
      item: () => ({}),
      header: 'Hero',
      droppable: () => false,
      onDraggable() {},
      onDrop() {},
      ...overrides,
    }) as unknown as FakeElement;
  });
  flush();
  return root;
};

const handleOf = (root: FakeElement): FakeElement =>
  findElement(root, (element) => hasClass(element, 'ohne-structure-drag-handle'))!;

/**
 * The header row of `root`, laid out from (0, 0) to (600, 40).
 */
const headerOf = (root: FakeElement): FakeElement =>
  Object.assign(
    findElement(root, (element) => hasClass(element, 'ohne-structure-item-header'))!,
    {
      getBoundingClientRect: () => ({ left: 0, top: 0, right: 600, bottom: 40 }),
    },
  );

/**
 * Every open menu panel on the body.
 */
const menus = (): FakeElement[] =>
  (document.body as unknown as FakeElement).childNodes.filter(
    (node): node is FakeElement =>
      node instanceof FakeElement && node.getAttribute('role') === 'menu',
  );

/**
 * The path from `element` up through its ancestors, innermost first, as an event bubbles.
 */
const pathOf = (element: FakeElement): FakeElement[] => {
  const path: FakeElement[] = [];
  for (let node: FakeElement | null = element; node; node = node.parentElement) path.push(node);
  return path;
};

const HERO: MenuGroup[] = [[{ label: 'Duplicate hero' }]];

describe('structureItem', () => {
  it('names the drag handle', () => {
    strictEqual(handleOf(mount()).getAttribute('aria-label'), 'Drag to reorder');
  });

  it('starts a touch drag on a still hold, and drops the hold once the finger moves', (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const drags: boolean[] = [];
    const handle = handleOf(mount({ onDraggable: (value) => value && drags.push(value.touch) }));
    fire(handle, 'touchstart', touchAt(0, 0));
    fire(handle, 'touchmove', touchAt(3, 3));
    t.mock.timers.tick(500);
    deepStrictEqual(drags, [true]);
    fire(handle, 'touchstart', touchAt(0, 0));
    fire(handle, 'touchmove', touchAt(0, 12));
    t.mock.timers.tick(500);
    fire(handle, 'touchstart', touchAt(0, 0));
    fire(handle, 'touchcancel');
    t.mock.timers.tick(500);
    deepStrictEqual(drags, [true]);
  });

  it('drops on a pointerup over a zone', () => {
    const drops: string[] = [];
    const root = mount({ droppable: () => true, onDrop: (position) => drops.push(position) });
    const zone = (position: string): FakeElement =>
      findElement(root, (element) => hasClass(element, `ohne-structure-item-zone-${position}`))!;
    fire(zone('after'), 'pointerup');
    fire(zone('before'), 'pointerup');
    deepStrictEqual(drops, ['after', 'before']);
  });

  it('opens its menu on a right-click of the header row, read on each open', () => {
    let opens = 0;
    const root = mount({
      menu: () => {
        opens += 1;
        return HERO;
      },
    });
    const header = headerOf(root);
    const event = bubble(pathOf(header), 'contextmenu', {
      target: header,
      clientX: 120,
      clientY: 20,
    });
    deepStrictEqual(
      [event.defaultPrevented, opens, menus().at(-1)?.textContent],
      [true, 1, 'Duplicate hero'],
    );
    menus().at(-1)?.remove();
  });

  it('leaves the body, the drag handle, and a header without a menu to the browser', () => {
    const root = mount({ body: () => document.createElement('p'), menu: () => HERO });
    const before = menus().length;
    const paragraph = findElement(root, (element) => element.tagName === 'P')!;
    for (const target of [paragraph, handleOf(root)]) {
      const event = bubble(pathOf(target), 'contextmenu', { target, clientX: 120, clientY: 20 });
      strictEqual(event.defaultPrevented, false);
    }
    const bare = headerOf(mount());
    strictEqual(
      fire(bare, 'contextmenu', { target: bare, clientX: 120, clientY: 20 }).defaultPrevented,
      false,
    );
    strictEqual(menus().length, before);
  });

  it('opens its menu on a touch hold of the header, while a hold on the handle still drags', (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const drags: boolean[] = [];
    const root = mount({
      menu: () => HERO,
      onDraggable: (value) => value && drags.push(value.touch),
    });
    const before = menus().length;
    const handle = handleOf(root);
    bubble(pathOf(handle), 'touchstart', { target: handle, ...touchAt(10, 10) });
    t.mock.timers.tick(500);
    deepStrictEqual([drags, menus().length], [[true], before]);
    const header = headerOf(root);
    bubble(pathOf(header), 'touchstart', { target: header, ...touchAt(120, 20) });
    t.mock.timers.tick(500);
    deepStrictEqual([drags, menus().length], [[true], before + 1]);
    menus().at(-1)?.remove();
  });

  it('lets a touch pointer go, so its release reaches the zone under the finger', () => {
    const released: number[] = [];
    const target = {
      hasPointerCapture: (id: number) => id === 7,
      releasePointerCapture: (id: number) => released.push(id),
    };
    const handle = handleOf(mount());
    fire(handle, 'pointerdown', { pointerId: 7, target });
    fire(handle, 'pointerdown', { pointerId: 1, target });
    deepStrictEqual(released, [7]);
  });
});
