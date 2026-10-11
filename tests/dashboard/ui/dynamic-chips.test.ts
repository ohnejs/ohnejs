import { strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { flush } from '../../../src/utils/reactive/_scheduler.ts';
import { ref } from '../../../src/utils/reactive/ref.ts';
import { type FakeElement, findElement, hasClass } from '../_fake-dom.ts';
import './_events.ts';

const { dynamicChips } = await import('../../../src/dashboard/ui/dynamic-chips.ts');

describe('dynamicChips', () => {
  it('names each remove button after its chip', async () => {
    const root = dynamicChips(ref([7]), {
      choicesResolver: () =>
        Promise.resolve({ choices: [], currentPage: 1, lastPage: 1, perPage: 10, total: 0 }),
      selectedChoicesResolver: () => Promise.resolve([{ value: 7, label: 'Ada' }]),
    }) as unknown as FakeElement;
    await new Promise((resolve) => setTimeout(resolve));
    flush();
    const remove = findElement(root, (element) => hasClass(element, 'ohne-dynamic-chips-remove'));
    strictEqual(remove?.getAttribute('aria-label'), 'Remove Ada');
  });
});
