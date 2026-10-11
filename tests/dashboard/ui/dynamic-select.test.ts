import { strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import type { DynamicSelectChoice } from '../../../src/dashboard/ui/dynamic-select.ts';

import { flush } from '../../../src/utils/reactive/_scheduler.ts';
import { ref } from '../../../src/utils/reactive/ref.ts';
import { type FakeElement, findElement, hasClass } from '../_fake-dom.ts';
import { seedMessages } from '../_fake-messages.ts';
import './_events.ts';

await seedMessages({ 'app.thrall': 'Thrall', 'app.pickRaider': 'Pick a raider' });

const { dynamicSelect } = await import('../../../src/dashboard/ui/dynamic-select.ts');

const selectOf = (selected: DynamicSelectChoice<string>): HTMLElement =>
  dynamicSelect(ref<string>('thrall'), {
    choicesResolver: () =>
      Promise.resolve({ choices: [], currentPage: 1, lastPage: 1, perPage: 10, total: 0 }),
    selectedChoiceResolver: () => Promise.resolve(selected),
  });

const shown = (root: HTMLElement): FakeElement | undefined =>
  findElement(root as unknown as FakeElement, (el) =>
    hasClass(el, 'ohne-dynamic-select-selected-choice'),
  );

async function settle(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve));
  flush();
}

describe('dynamicSelect', () => {
  it('resolves a message key label', async () => {
    const root = selectOf({ value: 'thrall', label: 'app.thrall' });
    await settle();
    strictEqual(shown(root)?.textContent, 'Thrall');
    strictEqual(root.getAttribute('title'), 'Thrall');
  });

  it('keeps a getter label live', async () => {
    const name = ref('Horde');
    const root = selectOf({ value: 'thrall', label: () => name.value });
    await settle();
    name.value = 'Alliance';
    flush();
    strictEqual(shown(root)?.textContent, 'Alliance');
  });

  it('resolves a message key placeholder while nothing is selected', async () => {
    const root = dynamicSelect(ref<string>(''), {
      placeholder: 'app.pickRaider',
      choicesResolver: () =>
        Promise.resolve({ choices: [], currentPage: 1, lastPage: 1, perPage: 10, total: 0 }),
      selectedChoiceResolver: () => Promise.resolve(null),
    });
    await settle();
    const placeholder = findElement(root as unknown as FakeElement, (el) =>
      hasClass(el, 'ohne-dynamic-select-placeholder'),
    );
    strictEqual(placeholder?.textContent, 'Pick a raider');
  });
});
