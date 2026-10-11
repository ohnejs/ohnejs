import { strictEqual } from 'node:assert';
import { before, describe, it } from 'node:test';

import { flush } from '../../../src/utils/reactive/_scheduler.ts';
import { ref } from '../../../src/utils/reactive/ref.ts';
import { type FakeElement, findElement, hasClass } from '../_fake-dom.ts';

const { meter } = await import('../../../src/dashboard/ui/meter.ts');

before(() => {
  Object.assign(document, {
    getElementById: () => ({
      textContent: JSON.stringify({
        apiURL: 'http://api',
        defaultLanguage: 'en',
        messageGroups: [],
      }),
    }),
  });
});

function fill(element: FakeElement): FakeElement | undefined {
  return findElement(element, (el) => hasClass(el, 'ohne-meter-fill'));
}

describe('meter', () => {
  it('is a meter with its range, its share, and its label', () => {
    const element = meter(() => 120, { max: 480, label: 'Bank slots' }) as unknown as FakeElement;
    strictEqual(element.getAttribute('role'), 'meter');
    strictEqual(element.getAttribute('aria-valuemin'), '0');
    strictEqual(element.getAttribute('aria-valuemax'), '480');
    strictEqual(element.getAttribute('aria-valuenow'), '120');
    strictEqual(element.getAttribute('aria-label'), 'Bank slots');
    strictEqual(fill(element)!.getAttribute('style'), 'width: 25%');
    strictEqual(element.textContent, 'Bank slots25%');
  });

  it('clamps a value past either end', () => {
    const value = ref(150);
    const element = meter(() => value.value, { tone: 'destructive' }) as unknown as FakeElement;
    strictEqual(hasClass(element, 'ohne-tone-destructive'), true);
    strictEqual(element.getAttribute('aria-valuenow'), '100');
    strictEqual(fill(element)!.getAttribute('style'), 'width: 100%');
    value.value = -5;
    flush();
    strictEqual(element.getAttribute('aria-valuenow'), '0');
    strictEqual(fill(element)!.getAttribute('style'), 'width: 0%');
  });

  it('holds a placeholder bar while the value loads, then keeps the bar it fills', () => {
    const value = ref<number | undefined>(undefined);
    const element = meter(() => value.value) as unknown as FakeElement;
    strictEqual(element.getAttribute('aria-busy'), 'true');
    strictEqual(fill(element), undefined);
    strictEqual(findElement(element, (el) => hasClass(el, 'ohne-skeleton'))?.tagName, 'DIV');
    value.value = 40;
    flush();
    const bar = fill(element)!;
    strictEqual(element.getAttribute('aria-busy'), null);
    value.value = 60;
    flush();
    strictEqual(fill(element), bar);
    strictEqual(bar.getAttribute('style'), 'width: 60%');
  });
});
