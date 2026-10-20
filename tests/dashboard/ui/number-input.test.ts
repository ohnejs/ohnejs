import { strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { flush } from '../../../src/utils/reactive/_scheduler.ts';
import { ref } from '../../../src/utils/reactive/ref.ts';
import { type FakeElement, findElement, hasClass } from '../_fake-dom.ts';
import { fire } from './_events.ts';

const documentListeners = new Map<string, Set<(event: unknown) => void>>();
Object.assign(document, {
  addEventListener(type: string, listener: (event: unknown) => void) {
    documentListeners.set(type, (documentListeners.get(type) ?? new Set()).add(listener));
  },
  removeEventListener(type: string, listener: (event: unknown) => void) {
    documentListeners.get(type)?.delete(listener);
  },
});
Object.assign(globalThis, { MouseEvent: class {} });

const fireDocument = (type: string, init: Record<string, unknown> = {}): void => {
  for (const listener of documentListeners.get(type) ?? []) listener({ type, ...init });
};
const touchAt = (clientX: number): Record<string, unknown> => ({ touches: [{ clientX }] });
const inputOf = (root: FakeElement): FakeElement & { value: string } =>
  findElement(root, (element) => element.tagName === 'INPUT') as FakeElement & { value: string };

const { numberInput } = await import('../../../src/dashboard/ui/number-input.ts');

describe('numberInput', () => {
  it('shows a `null` model empty, and steps from empty to `min`', () => {
    const model = ref<number | null>(null);
    const root = numberInput(model, { min: 8, max: 20 }) as unknown as FakeElement;
    const input = inputOf(root);
    flush();
    strictEqual(input.value, '');
    fire(input, 'blur');
    flush();
    strictEqual(input.value, '');
    strictEqual(model.value, null);
    fire(input, 'keydown', { key: 'ArrowUp', preventDefault() {}, stopPropagation() {} });
    flush();
    strictEqual(input.value, '8');
    strictEqual(model.value, 8);
  });

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

  it('hides the pointer-only steppers from assistive tech', () => {
    const root = numberInput(ref(1), { showSteppers: true }) as unknown as FakeElement;
    flush();
    const steppers = findElement(root, (element) => hasClass(element, 'ohne-number-steppers'));
    strictEqual(steppers?.getAttribute('aria-hidden'), 'true');
  });

  it('asks for a digit pad only when `min` rules out negatives', () => {
    const mode = (options: Parameters<typeof numberInput>[1]): string | null =>
      inputOf(numberInput(ref(1), options) as unknown as FakeElement).getAttribute('inputmode');
    strictEqual(mode({ min: 0 }), 'numeric');
    strictEqual(mode({ min: 0, decimalPlaces: 2 }), 'decimal');
    strictEqual(mode({ min: -5 }), null);
    strictEqual(mode({}), null);
  });

  it('settles and commits the typed value on Enter', () => {
    const model = ref(1);
    const commits: number[] = [];
    const root = numberInput(model, { min: 1, max: 3, onCommit: (value) => commits.push(value) });
    const input = inputOf(root as unknown as FakeElement);
    input.value = '21';
    fire(input, 'input');
    fire(input, 'keydown', { key: 'Enter' });
    strictEqual(model.value, 3);
    strictEqual(commits.at(-1), 3);
  });

  it('stops tracking a drag when the touch is cancelled', () => {
    const model = ref(150);
    const root = numberInput(model, { showDragButton: true }) as unknown as FakeElement;
    flush();
    const button = findElement(root, (element) => hasClass(element, 'ohne-number-icon'));
    fire(button as FakeElement, 'touchstart', touchAt(0));
    fireDocument('touchmove', touchAt(20));
    strictEqual(model.value, 170);
    fireDocument('touchcancel');
    fireDocument('touchmove', touchAt(220));
    strictEqual(model.value, 170);
  });
});
