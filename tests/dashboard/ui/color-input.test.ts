import { deepStrictEqual, strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { flush } from '../../../src/utils/reactive/_scheduler.ts';
import { ref } from '../../../src/utils/reactive/ref.ts';
import { type FakeElement, findElement, hasClass } from '../_fake-dom.ts';
import '../fields/_controls.ts';
import { fire } from './_events.ts';

const { colorInput } = await import('../../../src/dashboard/ui/color-input.ts');

/**
 * The first element under `root` carrying the `aria-label` `label`.
 */
const labeled = (root: unknown, label: string) =>
  findElement(
    root as FakeElement,
    (element) => element.getAttribute('aria-label') === label,
  ) as FakeElement;

/**
 * The swatch buttons under `root`, in order.
 */
const swatchesOf = (root: unknown) =>
  findElement(root as FakeElement, (element) => hasClass(element, 'ohne-color-swatches'))!
    .childNodes as FakeElement[];

describe('colorInput', () => {
  it('writes an opaque pick on a model without `alpha`', () => {
    const tint = ref('#ff880080');
    const root = colorInput(tint);
    const picker = labeled(root, 'Pick a color') as unknown as { value: string };
    picker.value = '#336699';
    fire(picker as unknown as FakeElement, 'input');
    flush();
    strictEqual(tint.value, '#336699');
  });

  it('keeps the opacity when an opaque swatch changes the color', () => {
    const tint = ref('#ff880080');
    const root = colorInput(tint, { alpha: true, swatches: ['#0070DD'] });
    fire(swatchesOf(root)[0], 'click');
    flush();
    strictEqual(tint.value, '#0070dd80');
  });

  it('marks the swatch the model holds, at any opacity', () => {
    const tint = ref('#a335eecc');
    const root = colorInput(tint, { alpha: true, swatches: ['#0070dd', '#a335ee'] });
    deepStrictEqual(
      swatchesOf(root).map((swatch) => swatch.getAttribute('aria-pressed')),
      ['false', 'true'],
    );
  });

  it('labels its parts in English by default, and follows label getters', () => {
    const pick = ref('Farbe wählen');
    const root = colorInput(ref(''), { alpha: true, labels: { pick: () => pick.value } });
    strictEqual(labeled(root, 'Opacity')?.tagName, 'INPUT');
    strictEqual(labeled(root, 'Farbe wählen')?.tagName, 'INPUT');
    pick.value = 'Odaberi boju';
    flush();
    strictEqual(labeled(root, 'Odaberi boju')?.tagName, 'INPUT');
  });

  it('clamps a typed opacity, so every keystroke writes a valid hex', () => {
    const tint = ref('#ff8800');
    const opacity = labeled(colorInput(tint, { alpha: true }), 'Opacity') as unknown as {
      value: string;
    };
    for (const text of ['1', '15', '150', '-5']) {
      opacity.value = text;
      fire(opacity as unknown as FakeElement, 'input');
      flush();
      strictEqual(
        /^#[\da-f]{6}(?:[\da-f]{2})?$/.test(tint.value),
        true,
        `${text} -> ${tint.value}`,
      );
    }
    fire(opacity as unknown as FakeElement, 'blur');
    flush();
    strictEqual(tint.value.slice(0, 7), '#ff8800');
  });

  it('leaves an empty or unparsed color alone when the opacity blurs', () => {
    for (const initial of ['', '#ggg']) {
      const tint = ref(initial);
      fire(labeled(colorInput(tint, { alpha: true }), 'Opacity'), 'blur');
      flush();
      strictEqual(tint.value, initial);
    }
  });
});
