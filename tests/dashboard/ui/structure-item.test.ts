import { strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { flush } from '../../../src/utils/reactive/_scheduler.ts';
import { type FakeElement, findElement, hasClass } from '../_fake-dom.ts';
import './_events.ts';

const { structureItem } = await import('../../../src/dashboard/ui/structure-item.ts');

describe('structureItem', () => {
  it('names the drag handle', () => {
    const root = structureItem({
      item: () => ({}),
      header: 'Hero',
      droppable: () => false,
      onDraggable() {},
      onDrop() {},
    }) as unknown as FakeElement;
    flush();
    const handle = findElement(root, (element) => hasClass(element, 'ohne-structure-drag-handle'));
    strictEqual(handle?.getAttribute('aria-label'), 'Drag to reorder');
  });
});
