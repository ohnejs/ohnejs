import { deepStrictEqual, strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import type { StructureItemOptions } from '../../../src/dashboard/ui/structure-item.ts';

import { flush } from '../../../src/utils/reactive/_scheduler.ts';
import { type FakeElement, findElement, hasClass } from '../_fake-dom.ts';
import { fire } from './_events.ts';

const { structureItem } = await import('../../../src/dashboard/ui/structure-item.ts');

const touchAt = (clientX: number, clientY: number): Record<string, unknown> => ({
  touches: [{ clientX, clientY }],
});

const mount = (overrides: Partial<StructureItemOptions> = {}): FakeElement => {
  const root = structureItem({
    item: () => ({}),
    header: 'Hero',
    droppable: () => false,
    onDraggable() {},
    onDrop() {},
    ...overrides,
  }) as unknown as FakeElement;
  flush();
  return root;
};

const handleOf = (root: FakeElement): FakeElement =>
  findElement(root, (element) => hasClass(element, 'ohne-structure-drag-handle'))!;

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
