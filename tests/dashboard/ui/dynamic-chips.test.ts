import { deepStrictEqual, strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import type { Primitive } from '../../../src/dashboard/ui/button-group.ts';
import type { DynamicChipsChoice } from '../../../src/dashboard/ui/dynamic-chips.ts';

import { flush } from '../../../src/utils/reactive/_scheduler.ts';
import { nextTick } from '../../../src/utils/reactive/next-tick.ts';
import { ref } from '../../../src/utils/reactive/ref.ts';
import { FakeElement, findElement, hasClass } from '../_fake-dom.ts';
import { seedMessages } from '../_fake-messages.ts';
import { fire, undoKeydown } from './_events.ts';

await seedMessages({ 'app.thrall': 'Thrall' });

const keydowns = new WeakMap<object, (event: unknown) => void>();
const listen = FakeElement.prototype.addEventListener as (
  type: string,
  listener: (event: unknown) => void,
) => void;
Object.assign(FakeElement.prototype, {
  addEventListener(this: FakeElement, type: string, listener: (event: unknown) => void) {
    if (type === 'keydown') keydowns.set(this, listener);
    listen.call(this, type, listener);
  },
});

const { dynamicChips } = await import('../../../src/dashboard/ui/dynamic-chips.ts');
const { isMac } = await import('../../../src/dashboard/ui/hotkeys.ts');

const chipsOf = (selected: DynamicChipsChoice[]): FakeElement =>
  dynamicChips(ref([7]), {
    choicesResolver: () =>
      Promise.resolve({ choices: [], currentPage: 1, lastPage: 1, perPage: 10, total: 0 }),
    selectedChoicesResolver: () => Promise.resolve(selected),
  }) as unknown as FakeElement;

const label = (root: FakeElement): FakeElement | undefined =>
  findElement(root, (element) => hasClass(element, 'ohne-dynamic-chips-label'));

async function settle(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve));
  flush();
}

describe('dynamicChips', () => {
  it('names each remove button after its chip', async () => {
    const root = dynamicChips(ref([7]), {
      choicesResolver: () =>
        Promise.resolve({ choices: [], currentPage: 1, lastPage: 1, perPage: 10, total: 0 }),
      selectedChoicesResolver: () => Promise.resolve([{ value: 7, label: 'Jaina' }]),
    }) as unknown as FakeElement;
    await new Promise((resolve) => setTimeout(resolve));
    flush();
    const remove = findElement(root, (element) => hasClass(element, 'ohne-dynamic-chips-remove'));
    strictEqual(remove?.getAttribute('aria-label'), 'Remove Jaina');
  });

  it('resolves a message key label', async () => {
    const root = chipsOf([{ value: 7, label: 'app.thrall' }]);
    await settle();
    strictEqual(label(root)?.textContent, 'Thrall');
    strictEqual(label(root)?.getAttribute('title'), 'Thrall');
  });

  it('keeps a getter label live', async () => {
    const name = ref('Horde');
    const root = chipsOf([{ value: 7, label: () => name.value }]);
    await settle();
    name.value = 'Alliance';
    flush();
    strictEqual(label(root)?.textContent, 'Alliance');
  });

  describe('undo in the text input', () => {
    /**
     * Presses the platform's undo in the text input holding `keyword`, and says whether it went up.
     */
    const undoIn = (keyword: string): boolean => {
      const root = chipsOf([]);
      const input = findElement(root, (element) =>
        hasClass(element, 'ohne-dynamic-chips-input'),
      ) as FakeElement & { value: string };
      input.value = keyword;
      fire(input, 'input');
      flush();
      let bubbled = true;
      const mac = isMac();
      keydowns.get(input)?.({
        key: 'z',
        ctrlKey: !mac,
        metaKey: mac,
        altKey: false,
        shiftKey: false,
        preventDefault() {},
        stopPropagation: () => (bubbled = false),
      });
      return bubbled;
    };

    it('keeps it from an app history while the input holds a keyword', () => {
      strictEqual(undoIn('Thr'), false);
    });

    it('lets it through to the history once the input is empty', () => {
      strictEqual(undoIn(''), true);
    });

    it('clears the keyword on a pick, so the next undo reaches the app history', async () => {
      const model = ref<Primitive[]>([]);
      const root = dynamicChips(model, {
        choicesResolver: () =>
          Promise.resolve({
            choices: [{ value: 3, label: 'Goblin Radio' }],
            currentPage: 1,
            lastPage: 1,
            perPage: 10,
            total: 1,
          }),
        selectedChoicesResolver: () => Promise.resolve([]),
      }) as unknown as FakeElement;
      const input = findElement(root, (element) =>
        hasClass(element, 'ohne-dynamic-chips-input'),
      ) as FakeElement & { value: string };
      fire(input, 'focus');
      input.value = 'gob';
      fire(input, 'input');
      flush();
      await new Promise((resolve) => setTimeout(resolve, 300));
      flush();
      keydowns.get(input)?.({ key: 'Enter', preventDefault() {}, stopPropagation() {} });
      flush();
      deepStrictEqual([model.value, input.value], [[3], '']);
      let bubbled = true;
      keydowns.get(input)?.({ ...undoKeydown(), stopPropagation: () => (bubbled = false) });
      strictEqual(bubbled, true);
    });
  });

  describe('focus', () => {
    const inputOf = (root: FakeElement): FakeElement =>
      findElement(root, (element) => hasClass(element, 'ohne-dynamic-chips-input'))!;

    it('closes the dropdown on Escape and keeps focus', () => {
      const root = chipsOf([]);
      const input = inputOf(root);
      let blurred = false;
      Object.assign(input, { blur: () => (blurred = true) });
      fire(input, 'focus');
      flush();
      strictEqual(hasClass(root, 'ohne-dynamic-chips-dropdown-visible'), true);
      strictEqual(fire(input, 'keydown', { key: 'Escape' }).propagationStopped, true);
      flush();
      strictEqual(hasClass(root, 'ohne-dynamic-chips-dropdown-visible'), false);
      strictEqual(fire(input, 'keydown', { key: 'Escape' }).propagationStopped, false);
      strictEqual(blurred, false);
    });

    it('focuses the input without the dropdown once its last chip is removed', async () => {
      const model = ref([7]);
      const root = dynamicChips(model, {
        choicesResolver: () =>
          Promise.resolve({ choices: [], currentPage: 1, lastPage: 1, perPage: 10, total: 0 }),
        selectedChoicesResolver: () => Promise.resolve([{ value: 7, label: 'Jaina' }]),
      }) as unknown as FakeElement;
      await settle();
      const input = inputOf(root);
      let focused = false;
      Object.assign(input, { focus: () => (focused = true) });
      Object.assign(document, { activeElement: document.body });
      fire(
        findElement(root, (element) => hasClass(element, 'ohne-dynamic-chips-remove'))!,
        'click',
      );
      await nextTick();
      Object.assign(document, { activeElement: null });
      strictEqual(focused, true);
      strictEqual(hasClass(root, 'ohne-dynamic-chips-dropdown-visible'), false);
    });
  });

  describe('touch', () => {
    it('leaves a touch on a chip to the page and calls a double tap a double-click', async () => {
      const opened: Primitive[] = [];
      const root = dynamicChips(ref([7]), {
        choicesResolver: () =>
          Promise.resolve({ choices: [], currentPage: 1, lastPage: 1, perPage: 10, total: 0 }),
        selectedChoicesResolver: () => Promise.resolve([{ value: 7, label: 'Jaina' }]),
        onDblclick: (value) => opened.push(value),
      }) as unknown as FakeElement;
      await settle();
      const chip = findElement(root, (element) => hasClass(element, 'ohne-dynamic-chips-item'))!;
      const touches = [{ clientX: 0, clientY: 0 }];
      const starts = [0, 150].map((timeStamp) => {
        const start = fire(chip, 'touchstart', { touches, timeStamp });
        fire(chip, 'touchend', { timeStamp: timeStamp + 50 });
        return start.defaultPrevented;
      });
      deepStrictEqual([starts, opened], [[false, false], [7]]);
    });
  });
});
