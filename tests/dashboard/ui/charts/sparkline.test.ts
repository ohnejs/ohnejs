import { ok, strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { flush } from '../../../../src/utils/reactive/_scheduler.ts';
import { ref } from '../../../../src/utils/reactive/ref.ts';
import { type FakeElement } from '../../_fake-dom.ts';
import { byClass } from './_chart-dom.ts';

const { sparkline } = await import('../../../../src/dashboard/ui/charts/sparkline.ts');

describe('sparkline', () => {
  it('holds a placeholder, then draws a line its lowest to highest value', () => {
    const values = ref<number[] | undefined>(undefined);
    const element = sparkline(() => values.value) as unknown as FakeElement;
    strictEqual(element.getAttribute('aria-hidden'), 'true');
    ok(byClass(element, 'ohne-skeleton'));
    values.value = [10, 20, 15];
    flush();
    strictEqual(byClass(element, 'ohne-sparkline-line')!.getAttribute('d'), 'M0,26L50,2L100,14');
    strictEqual(byClass(element, 'ohne-sparkline-area'), undefined);
  });

  it('washes the area when asked and draws nothing for a single value', () => {
    ok(
      byClass(
        sparkline(() => [1, 3], { area: true }) as unknown as FakeElement,
        'ohne-sparkline-area',
      ),
    );
    strictEqual(
      byClass(sparkline(() => [4]) as unknown as FakeElement, 'ohne-sparkline-line'),
      undefined,
    );
  });
});
