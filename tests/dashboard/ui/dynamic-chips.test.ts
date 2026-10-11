import { strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import type { DynamicChipsChoice } from '../../../src/dashboard/ui/dynamic-chips.ts';

import { flush } from '../../../src/utils/reactive/_scheduler.ts';
import { ref } from '../../../src/utils/reactive/ref.ts';
import { type FakeElement, findElement, hasClass } from '../_fake-dom.ts';
import { seedMessages } from '../_fake-messages.ts';
import './_events.ts';

await seedMessages({ 'app.thrall': 'Thrall' });

const { dynamicChips } = await import('../../../src/dashboard/ui/dynamic-chips.ts');

const chipsOf = (selected: DynamicChipsChoice[]): FakeElement =>
  dynamicChips(ref([7]), {
    choicesResolver: () =>
      Promise.resolve({ choices: [], currentPage: 1, lastPage: 1, perPage: 10, total: 0 }),
    selectedChoicesResolver: () => Promise.resolve(selected),
  }) as unknown as FakeElement;

const label = (root: FakeElement): FakeElement | undefined =>
  findElement(root, (element) => hasClass(element, 'ohne-dynamic-chips-label'));

async function settle(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve));
  flush();
}

describe('dynamicChips', () => {
  it('names each remove button after its chip', async () => {
    const root = dynamicChips(ref([7]), {
      choicesResolver: () =>
        Promise.resolve({ choices: [], currentPage: 1, lastPage: 1, perPage: 10, total: 0 }),
      selectedChoicesResolver: () => Promise.resolve([{ value: 7, label: 'Jaina' }]),
    }) as unknown as FakeElement;
    await new Promise((resolve) => setTimeout(resolve));
    flush();
    const remove = findElement(root, (element) => hasClass(element, 'ohne-dynamic-chips-remove'));
    strictEqual(remove?.getAttribute('aria-label'), 'Remove Jaina');
  });

  it('resolves a message key label', async () => {
    const root = chipsOf([{ value: 7, label: 'app.thrall' }]);
    await settle();
    strictEqual(label(root)?.textContent, 'Thrall');
    strictEqual(label(root)?.getAttribute('title'), 'Thrall');
  });

  it('keeps a getter label live', async () => {
    const name = ref('Horde');
    const root = chipsOf([{ value: 7, label: () => name.value }]);
    await settle();
    name.value = 'Alliance';
    flush();
    strictEqual(label(root)?.textContent, 'Alliance');
  });
});
