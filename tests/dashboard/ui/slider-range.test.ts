import { deepStrictEqual, match, strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import type { SliderRangeOptions } from '../../../src/dashboard/ui/slider-range.ts';

import { flush } from '../../../src/utils/reactive/_scheduler.ts';
import { ref } from '../../../src/utils/reactive/ref.ts';
import { FakeElement } from '../_fake-dom.ts';
import { fire } from './_events.ts';

type Listener = (event: unknown) => void;
const global = new Map<string, Set<Listener>>();
Object.assign(window, {
  addEventListener: (type: string, listener: Listener) =>
    global.set(type, (global.get(type) ?? new Set()).add(listener)),
  removeEventListener: (type: string, listener: Listener) => global.get(type)?.delete(listener),
});
const dispatch = (type: string, init: Record<string, unknown> = {}): void => {
  for (const listener of global.get(type) ?? []) listener({ type, ...init });
};

const { sliderRange } = await import('../../../src/dashboard/ui/slider-range.ts');

type Ends = [number | undefined, number | undefined];
type Thumb = FakeElement & { value: string };

/**
 * A slider range on a 110px track with 10px thumbs, so a pointer at `x` sits at ratio `(x - 5) / 100`.
 */
function mount(ends: Ends, options: Partial<SliderRangeOptions> = {}) {
  const model = ref<Ends>(ends);
  const root = sliderRange(model, {
    min: 0,
    max: 100,
    step: 10,
    ...options,
  }) as unknown as FakeElement;
  const [start, end] = root.childNodes as Thumb[];
  const fill: string[] = [];
  Object.assign(root, { getBoundingClientRect: () => ({ left: 0, width: 110 }) });
  Object.assign(start!, { getBoundingClientRect: () => ({ height: 10 }) });
  Object.assign(root.style, { setProperty: (_: string, value: string) => fill.push(value) });
  model.value = [...ends];
  flush();
  return { model, root, start: start!, end: end!, fill };
}

const slide = (thumb: Thumb, value: number): void => {
  thumb.value = String(value);
  fire(thumb, 'input');
  flush();
};

describe('sliderRange', () => {
  it('renders two native ranges on one grid, following the model', () => {
    const { model, start, end } = mount([20, 60]);
    for (const thumb of [start, end]) {
      deepStrictEqual(
        ['type', 'min', 'max', 'step'].map((name) => thumb.getAttribute(name)),
        ['range', '0', '100', '10'],
      );
    }
    deepStrictEqual([start.value, end.value], ['20', '60']);
    model.value = [30, 40];
    flush();
    deepStrictEqual([start.value, end.value], ['30', '40']);
  });

  it('writes each end as its thumb moves, rounded to the grid decimals', () => {
    const { model, start, end } = mount([0.1, 0.5], { min: 0.1, max: 1, step: 0.1 });
    slide(start, 0.1 + 0.2);
    slide(end, 0.7);
    deepStrictEqual(model.value, [0.3, 0.7]);
  });

  it('stops a thumb at the other one instead of crossing it', () => {
    const { model, start, end } = mount([20, 60]);
    slide(start, 90);
    deepStrictEqual(model.value, [60, 60]);
    slide(end, 10);
    deepStrictEqual(model.value, [60, 60]);
    strictEqual(end.value, '60');
  });

  it('keeps the gap within `minRange` and `maxRange`', () => {
    const { model, start, end } = mount([20, 60], { minRange: 20, maxRange: 50 });
    slide(start, 50);
    deepStrictEqual(model.value, [40, 60]);
    slide(end, 100);
    deepStrictEqual(model.value, [40, 90]);
    slide(start, 0);
    deepStrictEqual(model.value, [40, 90]);
  });

  it('keeps a thumb on the track when the other end leaves no room for the gap', () => {
    const low = mount([undefined, 10], { minRange: 20 });
    slide(low.start, 0);
    deepStrictEqual(low.model.value, [0, 10]);
    const high = mount([90, undefined], { minRange: 20 });
    slide(high.end, 100);
    deepStrictEqual(high.model.value, [90, 100]);
  });

  it('rests empty ends at the track ends', () => {
    const { model, start, end, fill } = mount([undefined, undefined]);
    deepStrictEqual([start.value, end.value], ['0', '100']);
    strictEqual(fill.at(-1), 'hsl(var(--ohne-border))');
    slide(start, 30);
    deepStrictEqual(model.value, [30, undefined]);
    deepStrictEqual([start.value, end.value], ['30', '100']);
  });

  it('fills the track between the thumb centers', () => {
    const { fill } = mount([20, 60]);
    match(fill.at(-1)!, /--ohne-border\)\) calc\(.* \* 0\.2\), hsl\(var\(--ohne-primary\)\) calc/);
    match(fill.at(-1)!, /--ohne-primary\)\) calc\(.* \* 0\.6\), hsl\(var\(--ohne-border\)\) calc/);
  });

  it('moves the nearer thumb to a press on the track, and drags it until release', () => {
    const { model, root, start } = mount([20, 60]);
    fire(root, 'pointerdown', { target: root, clientX: 35 });
    flush();
    deepStrictEqual(model.value, [30, 60]);
    strictEqual(start.getAttribute('data-dragging'), 'true');
    dispatch('pointermove', { clientX: 95 });
    flush();
    deepStrictEqual(model.value, [60, 60]);
    dispatch('pointerup');
    strictEqual(start.getAttribute('data-dragging'), null);
    dispatch('pointermove', { clientX: 5 });
    deepStrictEqual(model.value, [60, 60]);
  });

  it('restores both ends when the browser takes a press as a scroll', () => {
    const { model, root, start } = mount([20, 60]);
    fire(root, 'pointerdown', { target: root, clientX: 35 });
    flush();
    deepStrictEqual(model.value, [30, 60]);
    dispatch('pointercancel');
    flush();
    deepStrictEqual(model.value, [20, 60]);
    fire(start, 'pointerdown');
    slide(start, 40);
    dispatch('pointercancel');
    flush();
    deepStrictEqual(model.value, [20, 60]);
  });

  it('picks a thumb by side when both share a value', () => {
    const { model, root } = mount([50, 50]);
    fire(root, 'pointerdown', { target: root, clientX: 75 });
    dispatch('pointerup');
    flush();
    deepStrictEqual(model.value, [50, 70]);
    model.value = [50, 50];
    fire(root, 'pointerdown', { target: root, clientX: 25 });
    dispatch('pointerup');
    deepStrictEqual(model.value, [20, 50]);
  });

  it('leaves a press on a thumb to the native input', () => {
    const { model, root, end } = mount([20, 60]);
    fire(root, 'pointerdown', { target: end, clientX: 5 });
    deepStrictEqual(model.value, [20, 60]);
  });

  it('raises the last thumb moved, or the one that can still move', () => {
    const raised = (thumb: Thumb): boolean => thumb.getAttribute('data-raised') !== null;
    const { model, start, end } = mount([20, 60]);
    deepStrictEqual([raised(start), raised(end)], [false, true]);
    slide(start, 30);
    deepStrictEqual([raised(start), raised(end)], [true, false]);
    model.value = [0, 0];
    flush();
    deepStrictEqual([raised(start), raised(end)], [false, true]);
    model.value = [100, 100];
    flush();
    deepStrictEqual([raised(start), raised(end)], [true, false]);
  });

  it('follows `disabled`, and ignores presses meanwhile', () => {
    const off = ref(false);
    const { model, root, start, end } = mount([20, 60], { disabled: () => off.value });
    off.value = true;
    flush();
    deepStrictEqual(
      [start, end].map((thumb) => thumb.getAttribute('disabled')),
      ['', ''],
    );
    fire(root, 'pointerdown', { target: root, clientX: 5 });
    fire(start, 'pointerdown');
    deepStrictEqual(model.value, [20, 60]);
    strictEqual(start.getAttribute('data-dragging'), null);
  });

  it('marks only the thumbs whose end `invalid` names', () => {
    const failing = ref<0 | 1 | undefined>(1);
    const { start, end } = mount([20, 60], { invalid: (index) => index === failing.value });
    const marks = () => [start, end].map((thumb) => thumb.getAttribute('aria-invalid'));
    deepStrictEqual(marks(), [null, 'true']);
    failing.value = undefined;
    flush();
    deepStrictEqual(marks(), [null, null]);
  });
});
