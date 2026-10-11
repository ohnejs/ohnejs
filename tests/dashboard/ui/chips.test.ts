import { strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { flush } from '../../../src/utils/reactive/_scheduler.ts';
import { ref } from '../../../src/utils/reactive/ref.ts';
import { type FakeElement, findElement, hasClass } from '../_fake-dom.ts';
import './_events.ts';

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
});
