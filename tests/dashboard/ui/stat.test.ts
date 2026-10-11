import { ok, strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { changeOf, changeOfRate } from '../../../src/utils/number/change-of.ts';
import { flush } from '../../../src/utils/reactive/_scheduler.ts';
import { ref } from '../../../src/utils/reactive/ref.ts';
import { type FakeElement, hasClass } from '../_fake-dom.ts';
import { allByClass, byClass } from './charts/_chart-dom.ts';

const { delta, stat } = await import('../../../src/dashboard/ui/stat.ts');

describe('stat', () => {
  it('shows a plain number under its label, compact from ten thousand', () => {
    const element = stat(() => 12904, { label: 'Gold looted' }) as unknown as FakeElement;
    strictEqual(byClass(element, 'ohne-stat-label')!.textContent, 'Gold looted');
    strictEqual(byClass(element, 'ohne-stat-value')!.textContent, '12.9K');
    strictEqual(byClass(element, 'ohne-delta'), undefined);
    strictEqual(byClass(element, 'ohne-sparkline'), undefined);
  });

  it('holds a placeholder while loading, then the figure', () => {
    const value = ref<number | undefined>(undefined);
    const element = stat(() => value.value, { label: 'Raids cleared' }) as unknown as FakeElement;
    const figure = byClass(element, 'ohne-stat-value')!;
    strictEqual(figure.getAttribute('aria-busy'), 'true');
    ok(byClass(figure, 'ohne-skeleton'));
    value.value = 42;
    flush();
    strictEqual(figure.getAttribute('aria-busy'), null);
    strictEqual(figure.textContent, '42');
  });

  it('compares with the previous period and draws the trend', () => {
    const element = stat(() => ({ value: 1240, previous: 1000, trend: [800, 1000, 1240] }), {
      label: 'Raiders online',
    }) as unknown as FakeElement;
    const change = byClass(element, 'ohne-stat-change')!;
    strictEqual(change.textContent, '+24%vs 1,000');
    ok(hasClass(byClass(change, 'ohne-delta')!, 'ohne-tone-success'));
    ok(byClass(element, 'ohne-sparkline-line'));
  });

  it('reads a drop as good news when lower is better', () => {
    const element = stat(() => ({ value: 0.04, previous: 0.05 }), {
      label: 'Wipe rate',
      format: (value) => `${value * 100}%`,
      invert: true,
    }) as unknown as FakeElement;
    const pill = byClass(element, 'ohne-delta')!;
    strictEqual(pill.textContent, '-20%');
    ok(hasClass(pill, 'ohne-tone-success'));
    strictEqual(byClass(element, 'ohne-stat-change')!.textContent, '-20%vs 5%');
  });

  it('becomes a link with `href`', () => {
    const element = stat(() => 3, {
      label: 'Open tickets',
      href: '/tickets',
    }) as unknown as FakeElement;
    strictEqual(element.tagName, 'A');
    strictEqual(element.getAttribute('href'), '/tickets');
  });
});

describe('delta', () => {
  it('signs the change and tints it by whether it is good news', () => {
    const up = delta(() => changeOf(150, 100)) as unknown as FakeElement;
    strictEqual(up.textContent, '+50%');
    ok(hasClass(up, 'ohne-tone-success'));
    const down = delta(() => changeOf(97, 100)) as unknown as FakeElement;
    strictEqual(down.textContent, '-3.0%');
    ok(hasClass(down, 'ohne-tone-destructive'));
  });

  it('reads flat as 0%, growth from nothing as New, and points for a rate', () => {
    strictEqual((delta(() => changeOf(1001, 1000)) as unknown as FakeElement).textContent, '0%');
    strictEqual((delta(() => changeOf(5, 0)) as unknown as FakeElement).textContent, 'New');
    strictEqual(
      (delta(() => changeOfRate(0.12, 0.09)) as unknown as FakeElement).textContent,
      '+3 pts',
    );
  });

  it('hides a decline from nothing, as it has no ratio to read', () => {
    const element = delta(() => changeOf(-500, 0)) as unknown as FakeElement;
    strictEqual(element.getAttribute('hidden'), '');
    strictEqual(element.textContent, '');
    strictEqual((delta(() => changeOf(500, 0)) as unknown as FakeElement).textContent, 'New');
  });

  it('hides for no change to show', () => {
    const change = ref(changeOf(0, 0));
    const element = delta(() => change.value) as unknown as FakeElement;
    strictEqual(element.getAttribute('hidden'), '');
    strictEqual(element.textContent, '');
    change.value = changeOf(2, 1);
    flush();
    strictEqual(element.getAttribute('hidden'), null);
    strictEqual(allByClass(element, 'ohne-icon').length, 1);
  });
});
