import { strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { flush } from '../../../src/utils/reactive/_scheduler.ts';
import { ref } from '../../../src/utils/reactive/ref.ts';
import { type FakeElement, findElement, hasClass } from '../_fake-dom.ts';
import { seedMessages } from '../_fake-messages.ts';
import './_events.ts';

await seedMessages({ 'app.news': 'Breaking news' });

const { chips } = await import('../../../src/dashboard/ui/chips.ts');

describe('chips', () => {
  it('names each remove button after its chip', () => {
    const root = chips(ref(['news']), {
      choices: () => [{ value: 'news', label: 'Breaking news' }],
    }) as unknown as FakeElement;
    flush();
    const remove = findElement(root, (element) => hasClass(element, 'ohne-chips-remove'));
    strictEqual(remove?.getAttribute('aria-label'), 'Remove Breaking news');
  });

  it('resolves a message key label', () => {
    const root = chips(ref(['news']), {
      choices: () => [{ value: 'news', label: 'app.news' }],
    }) as unknown as FakeElement;
    flush();
    const label = findElement(root, (element) => hasClass(element, 'ohne-chips-label'));
    strictEqual(label?.textContent, 'Breaking news');
  });

  it('keeps a getter label live', () => {
    const name = ref('Horde');
    const root = chips(ref(['side']), {
      choices: () => [{ value: 'side', label: () => name.value }],
    }) as unknown as FakeElement;
    flush();
    name.value = 'Alliance';
    flush();
    const label = findElement(root, (element) => hasClass(element, 'ohne-chips-label'));
    strictEqual(label?.textContent, 'Alliance');
  });
});
