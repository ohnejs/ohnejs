import { strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import type { DynamicSelectChoice } from '../../../src/dashboard/ui/dynamic-select.ts';

import { flush } from '../../../src/utils/reactive/_scheduler.ts';
import { ref } from '../../../src/utils/reactive/ref.ts';
import { type FakeElement, findElement, hasClass } from '../_fake-dom.ts';
import { seedMessages } from '../_fake-messages.ts';
import { fire, undoKeydown } from './_events.ts';

await seedMessages({ 'app.thrall': 'Thrall', 'app.pickRaider': 'Pick a raider' });

const { dynamicSelect } = await import('../../../src/dashboard/ui/dynamic-select.ts');

const selectOf = (selected: DynamicSelectChoice<string>): HTMLElement =>
  dynamicSelect(ref<string>('thrall'), {
    choicesResolver: () =>
      Promise.resolve({ choices: [], currentPage: 1, lastPage: 1, perPage: 10, total: 0 }),
    selectedChoiceResolver: () => Promise.resolve(selected),
  });

const shown = (root: HTMLElement): FakeElement | undefined =>
  findElement(root as unknown as FakeElement, (el) =>
    hasClass(el, 'ohne-dynamic-select-selected-choice'),
  );

async function settle(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve));
  flush();
}

describe('dynamicSelect', () => {
  it('resolves a message key label', async () => {
    const root = selectOf({ value: 'thrall', label: 'app.thrall' });
    await settle();
    strictEqual(shown(root)?.textContent, 'Thrall');
    strictEqual(root.getAttribute('title'), 'Thrall');
  });

  it('keeps a getter label live', async () => {
    const name = ref('Horde');
    const root = selectOf({ value: 'thrall', label: () => name.value });
    await settle();
    name.value = 'Alliance';
    flush();
    strictEqual(shown(root)?.textContent, 'Alliance');
  });

  it('resolves a message key placeholder while nothing is selected', async () => {
    const root = dynamicSelect(ref<string>(''), {
      placeholder: 'app.pickRaider',
      choicesResolver: () =>
        Promise.resolve({ choices: [], currentPage: 1, lastPage: 1, perPage: 10, total: 0 }),
      selectedChoiceResolver: () => Promise.resolve(null),
    });
    await settle();
    const placeholder = findElement(root as unknown as FakeElement, (el) =>
      hasClass(el, 'ohne-dynamic-select-placeholder'),
    );
    strictEqual(placeholder?.textContent, 'Pick a raider');
  });

  describe('keyboard and focus', () => {
    const raidersOf = (model = ref<string>('thrall')): FakeElement =>
      dynamicSelect(model, {
        choicesResolver: () =>
          Promise.resolve({
            choices: [{ value: 'jaina', label: 'Jaina' }],
            currentPage: 1,
            lastPage: 1,
            perPage: 10,
            total: 1,
          }),
        selectedChoiceResolver: (value) => Promise.resolve({ value, label: value }),
      }) as unknown as FakeElement;

    const comboboxOf = (root: FakeElement): FakeElement =>
      findElement(root, (el) => hasClass(el, 'ohne-dynamic-select'))!;

    const keywordOf = (root: FakeElement): FakeElement & { value: string } =>
      findElement(root, (el) =>
        hasClass(el, 'ohne-dynamic-select-keyword-input'),
      ) as FakeElement & {
        value: string;
      };

    it('opens on Enter while closed', async () => {
      const combobox = comboboxOf(raidersOf());
      fire(combobox, 'keydown', { key: 'Enter' });
      await settle();
      strictEqual(combobox.getAttribute('aria-expanded'), 'true');
    });

    it('leaves Escape alone while closed, so focus stays', () => {
      const event = fire(comboboxOf(raidersOf()), 'keydown', { key: 'Escape' });
      strictEqual(event.defaultPrevented, false);
      strictEqual(event.propagationStopped, false);
    });

    it('returns focus to the combobox after a mouse pick', async () => {
      const model = ref<string>('thrall');
      const combobox = comboboxOf(raidersOf(model));
      fire(combobox, 'click');
      await settle();
      const row = findElement(combobox, (el) => hasClass(el, 'ohne-dynamic-select-choice'))!;
      let focused = false;
      Object.assign(combobox, {
        contains: (node: unknown) => node === row,
        focus: () => (focused = true),
      });
      Object.assign(document, { activeElement: row });
      fire(row, 'click');
      Object.assign(document, { activeElement: null });
      strictEqual(model.value, 'jaina');
      strictEqual(focused, true);
    });

    it('keeps undo in a search keyword from an app history', () => {
      const keyword = keywordOf(raidersOf());
      keyword.value = 'Ja';
      fire(keyword, 'input');
      strictEqual(fire(keyword, 'keydown', undoKeydown()).propagationStopped, true);
      keyword.value = '';
      fire(keyword, 'input');
      strictEqual(fire(keyword, 'keydown', undoKeydown()).propagationStopped, false);
    });
  });
});
