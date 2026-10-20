import { strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { flush } from '../../../src/utils/reactive/_scheduler.ts';
import { ref } from '../../../src/utils/reactive/ref.ts';
import { type FakeElement, findElement } from '../_fake-dom.ts';
import { fire } from './_events.ts';

type Listener = (event: unknown) => void;
const global = new Map<string, Set<Listener>>();
Object.assign(window, {
  addEventListener: (type: string, listener: Listener) =>
    global.set(type, (global.get(type) ?? new Set()).add(listener)),
  removeEventListener: (type: string, listener: Listener) => global.get(type)?.delete(listener),
});
const release = (type: string): void => {
  for (const listener of global.get(type) ?? []) listener({ type });
};

const { slider } = await import('../../../src/dashboard/ui/slider.ts');

const rangeOf = (root: unknown): FakeElement & { value: string } =>
  findElement(root as FakeElement, (element) => element.tagName === 'INPUT') as FakeElement & {
    value: string;
  };

describe('slider', () => {
  it('renders a native range over `min`, `max` and `step`', () => {
    const range = rangeOf(slider(ref<number | undefined>(2), { min: 0, max: 5, step: 0.5 }));
    strictEqual(range.getAttribute('type'), 'range');
    strictEqual(range.getAttribute('min'), '0');
    strictEqual(range.getAttribute('max'), '5');
    strictEqual(range.getAttribute('step'), '0.5');
  });

  it('moves the thumb with the model, and writes the model as it moves', () => {
    const model = ref<number | undefined>(2);
    const range = rangeOf(slider(model, { min: 0, max: 5, step: 0.5 }));
    flush();
    strictEqual(range.value, '2');
    model.value = 4;
    flush();
    strictEqual(range.value, '4');
    range.value = '1.5';
    fire(range, 'input');
    strictEqual(model.value, 1.5);
  });

  it('rounds a float artifact to the decimals of the grid', () => {
    const model = ref<number | undefined>(0);
    const range = rangeOf(slider(model, { min: 0.1, max: 1, step: 0.1 }));
    range.value = String(0.1 + 0.2);
    fire(range, 'input');
    strictEqual(model.value, 0.3);
  });

  it('steps by 1 without a `step`', () => {
    strictEqual(
      rangeOf(slider(ref<number | undefined>(undefined), { min: 0, max: 9 })).getAttribute('step'),
      '1',
    );
  });

  it('rests an empty model at `min`', () => {
    const model = ref<number | undefined>(undefined);
    const range = rangeOf(slider(model, { min: 3, max: 9 }));
    flush();
    strictEqual(range.value, '3');
  });

  it('follows `disabled`', () => {
    const off = ref(false);
    const range = rangeOf(slider(ref(1), { min: 0, max: 5, disabled: () => off.value }));
    flush();
    strictEqual(range.getAttribute('disabled'), null);
    off.value = true;
    flush();
    strictEqual(range.getAttribute('disabled'), '');
  });

  it('marks a drag from the press until the release anywhere', () => {
    for (const end of ['pointerup', 'pointercancel']) {
      const range = rangeOf(slider(ref(1), { min: 0, max: 5 }));
      fire(range, 'pointerdown');
      strictEqual(range.getAttribute('data-dragging'), 'true');
      release(end);
      strictEqual(range.getAttribute('data-dragging'), null);
      strictEqual(global.get(end)?.size, 0);
    }
  });

  it('marks no drag while disabled', () => {
    const range = rangeOf(slider(ref(1), { min: 0, max: 5, disabled: () => true }));
    fire(range, 'pointerdown');
    strictEqual(range.getAttribute('data-dragging'), null);
  });
});
