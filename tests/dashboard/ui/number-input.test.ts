import { strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { flush } from '../../../src/utils/reactive/_scheduler.ts';
import { ref } from '../../../src/utils/reactive/ref.ts';
import { type FakeElement, findElement, hasClass } from '../_fake-dom.ts';

const { numberInput } = await import('../../../src/dashboard/ui/number-input.ts');

describe('numberInput', () => {
  it('follows a suffix getter', () => {
    const suffix = ref('h');
    const root = numberInput(ref(1), { suffix: () => suffix.value }) as unknown as FakeElement;
    const span = findElement(root, (element) => hasClass(element, 'ohne-number-suffix'));
    strictEqual(span?.textContent, 'h');
    suffix.value = 'Std.';
    flush();
    strictEqual(span?.textContent, 'Std.');
  });

  it('follows a drag label getter', () => {
    const label = ref('Drag to adjust value');
    const root = numberInput(ref(1), {
      showDragButton: true,
      ariaDragLabel: () => label.value,
    }) as unknown as FakeElement;
    flush();
    const button = findElement(root, (element) => element.attributes.has('aria-label'));
    strictEqual(button?.getAttribute('aria-label'), 'Drag to adjust value');
    label.value = 'Ziehen zum Anpassen';
    flush();
    strictEqual(button?.getAttribute('aria-label'), 'Ziehen zum Anpassen');
  });
});
