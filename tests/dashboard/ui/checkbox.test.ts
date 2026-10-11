import { strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { flush } from '../../../src/utils/reactive/_scheduler.ts';
import { ref } from '../../../src/utils/reactive/ref.ts';
import { type FakeElement, findElement, hasClass } from '../_fake-dom.ts';
import './_events.ts';

const { checkbox } = await import('../../../src/dashboard/ui/checkbox.ts');

const box = (root: HTMLElement): FakeElement | undefined =>
  findElement(root as unknown as FakeElement, (element) =>
    hasClass(element, 'ohne-checkbox-button'),
  );

describe('checkbox', () => {
  it('names an unlabeled box with its aria label', () => {
    const name = ref('Select hero.png');
    const root = checkbox(ref(false), undefined, { ariaLabel: () => name.value });
    flush();
    strictEqual(box(root)?.getAttribute('aria-label'), 'Select hero.png');
    name.value = 'Select logo.svg';
    flush();
    strictEqual(box(root)?.getAttribute('aria-label'), 'Select logo.svg');
  });

  it('names a labeled box by its visible label', () => {
    const root = checkbox(ref(false), 'Published', { id: 'published', ariaLabel: 'Ignored' });
    flush();
    const label = findElement(root as unknown as FakeElement, (element) =>
      hasClass(element, 'ohne-checkbox-label'),
    );
    strictEqual(box(root)?.getAttribute('aria-labelledby'), 'published-label');
    strictEqual(label?.getAttribute('id'), 'published-label');
    strictEqual(box(root)?.getAttribute('aria-label'), null);
  });
});
