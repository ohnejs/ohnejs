import { strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { refocusAfterRemoval } from '../../../src/dashboard/ui/_chip-focus.ts';
import { nextTick } from '../../../src/utils/reactive/next-tick.ts';

const body = {};
Object.assign(globalThis, { document: { body, activeElement: body } });

/**
 * A remove button that records into `focused` when it takes focus.
 */
const button = (name: string, focused: string[]): HTMLElement =>
  ({ focus: () => focused.push(name) }) as unknown as HTMLElement;

/**
 * Removes the chip at `index` from a list left holding `names`, and returns what took focus.
 */
async function removeAt(index: number, names: string[]): Promise<string[]> {
  const focused: string[] = [];
  const list = { querySelectorAll: () => names.map((name) => button(name, focused)) };
  refocusAfterRemoval(list as unknown as Element, '.remove', index, () => focused.push('input'));
  await nextTick();
  return focused;
}

describe('refocusAfterRemoval', () => {
  it('moves to the X now at the removed index', async () => {
    strictEqual((await removeAt(0, ['b', 'c'])).join(), 'b');
  });

  it('falls back to the previous X after the last chip', async () => {
    strictEqual((await removeAt(2, ['a', 'b'])).join(), 'b');
  });

  it('falls back to the input once no chip is left', async () => {
    strictEqual((await removeAt(0, [])).join(), 'input');
  });

  it('leaves focus that did not fall to the body', async () => {
    Object.assign(document, { activeElement: {} });
    strictEqual((await removeAt(0, ['b'])).join(), '');
    Object.assign(document, { activeElement: body });
  });
});
