import { deepStrictEqual, strictEqual } from 'node:assert';
import { before, describe, it } from 'node:test';

import { flush } from '../../../src/utils/reactive/_scheduler.ts';
import { ref } from '../../../src/utils/reactive/ref.ts';
import { type FakeElement, hasClass } from '../_fake-dom.ts';

const { levelMeter } = await import('../../../src/dashboard/ui/level-meter.ts');

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

function litBars(element: FakeElement): boolean[] {
  return element.childNodes.map((bar) => hasClass(bar as FakeElement, 'ohne-level-meter-lit'));
}

describe('levelMeter', () => {
  it('is a labelled meter reading the level in percent', () => {
    const element = levelMeter(() => 0.42, {
      label: 'Caller',
      tone: 'success',
    }) as unknown as FakeElement;
    strictEqual(element.getAttribute('role'), 'meter');
    strictEqual(element.getAttribute('aria-valuemin'), '0');
    strictEqual(element.getAttribute('aria-valuemax'), '100');
    strictEqual(element.getAttribute('aria-valuenow'), '42');
    strictEqual(element.getAttribute('aria-label'), 'Caller');
    strictEqual(hasClass(element, 'ohne-tone-success'), true);
  });

  it('lights the rounded share of five rising bars', () => {
    const element = levelMeter(() => 0.42) as unknown as FakeElement;
    deepStrictEqual(litBars(element), [true, true, false, false, false]);
    deepStrictEqual(
      element.childNodes.map((bar) => (bar as FakeElement).getAttribute('style')),
      ['height: 40%', 'height: 55%', 'height: 70%', 'height: 85%', 'height: 100%'],
    );
  });

  it('follows the level and clamps it past either end', () => {
    const level = ref(0);
    const element = levelMeter(() => level.value, { bars: 3, size: -1 }) as unknown as FakeElement;
    strictEqual(element.getAttribute('style'), '--ohne-size: -1');
    deepStrictEqual(litBars(element), [false, false, false]);
    level.value = 1.7;
    flush();
    deepStrictEqual(litBars(element), [true, true, true]);
    strictEqual(element.getAttribute('aria-valuenow'), '100');
    level.value = -1;
    flush();
    strictEqual(element.getAttribute('aria-valuenow'), '0');
    deepStrictEqual(litBars(element), [false, false, false]);
  });

  it('draws a single bar at full height', () => {
    const element = levelMeter(() => 1, { bars: 1 }) as unknown as FakeElement;
    strictEqual((element.childNodes[0] as FakeElement).getAttribute('style'), 'height: 100%');
  });
});
