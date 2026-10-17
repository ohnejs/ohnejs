import { deepStrictEqual, strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { flush } from '../../../src/utils/reactive/_scheduler.ts';
import { nextTick } from '../../../src/utils/reactive/next-tick.ts';
import { ref } from '../../../src/utils/reactive/ref.ts';
import { type FakeElement, findElement, hasClass } from '../_fake-dom.ts';
import { seedMessages } from '../_fake-messages.ts';
import { fire, undoKeydown } from './_events.ts';

await seedMessages({ 'app.news': 'Breaking news' });

const { chips } = await import('../../../src/dashboard/ui/chips.ts');

describe('chips', () => {
  it('names each remove button after its chip', () => {
    const root = chips(ref(['news']), {
      choices: () => [{ value: 'news', label: 'Breaking news' }],
    }) as unknown as FakeElement;
    flush();
    const remove = findElement(root, (element) => hasClass(element, 'ohne-chips-remove'));
    strictEqual(remove?.getAttribute('aria-label'), 'Remove Breaking news');
  });

  it('resolves a message key label', () => {
    const root = chips(ref(['news']), {
      choices: () => [{ value: 'news', label: 'app.news' }],
    }) as unknown as FakeElement;
    flush();
    const label = findElement(root, (element) => hasClass(element, 'ohne-chips-label'));
    strictEqual(label?.textContent, 'Breaking news');
  });

  it('keeps a getter label live', () => {
    const name = ref('Horde');
    const root = chips(ref(['side']), {
      choices: () => [{ value: 'side', label: () => name.value }],
    }) as unknown as FakeElement;
    flush();
    name.value = 'Alliance';
    flush();
    const label = findElement(root, (element) => hasClass(element, 'ohne-chips-label'));
    strictEqual(label?.textContent, 'Alliance');
  });

  describe('the text input', () => {
    const fieldOf = (
      items: string[],
    ): { root: FakeElement; input: FakeElement & { value: string } } => {
      const root = chips(ref(items), {
        choices: () => [{ value: 'news' }, { value: 'sports' }],
      }) as unknown as FakeElement;
      flush();
      const input = findElement(root, (el) => hasClass(el, 'ohne-chips-input')) as FakeElement & {
        value: string;
      };
      return { root, input };
    };

    it('keeps undo of typed text from an app history', () => {
      const { input } = fieldOf([]);
      input.value = 'sp';
      fire(input, 'input');
      strictEqual(fire(input, 'keydown', undoKeydown()).propagationStopped, true);
      input.value = '';
      fire(input, 'input');
      strictEqual(fire(input, 'keydown', undoKeydown()).propagationStopped, false);
    });

    it('clears the keyword on a pick, so the next undo reaches the app history', () => {
      const model = ref<string[]>([]);
      const root = chips(model, {
        choices: () => [{ value: 'news' }, { value: 'goblin' }],
      }) as unknown as FakeElement;
      flush();
      const input = findElement(root, (el) => hasClass(el, 'ohne-chips-input')) as FakeElement & {
        value: string;
      };
      input.value = 'gob';
      fire(input, 'input');
      flush();
      fire(input, 'keydown', { key: 'Enter' });
      flush();
      deepStrictEqual([model.value, input.value], [['goblin'], '']);
      strictEqual(fire(input, 'keydown', undoKeydown()).propagationStopped, false);
    });

    it('closes the dropdown on Escape and keeps focus', () => {
      const { root, input } = fieldOf([]);
      let blurred = false;
      Object.assign(input, { blur: () => (blurred = true) });
      fire(input, 'focus');
      flush();
      strictEqual(hasClass(root, 'ohne-chips-dropdown-visible'), true);
      strictEqual(fire(input, 'keydown', { key: 'Escape' }).propagationStopped, true);
      flush();
      strictEqual(hasClass(root, 'ohne-chips-dropdown-visible'), false);
      strictEqual(fire(input, 'keydown', { key: 'Escape' }).propagationStopped, false);
      strictEqual(blurred, false);
    });

    it('takes focus without the dropdown once its last chip is removed', async () => {
      const { root, input } = fieldOf(['news']);
      let focused = false;
      Object.assign(input, { focus: () => (focused = true) });
      Object.assign(document, { activeElement: document.body });
      fire(findElement(root, (el) => hasClass(el, 'ohne-chips-remove'))!, 'click');
      await nextTick();
      Object.assign(document, { activeElement: null });
      strictEqual(focused, true);
      strictEqual(hasClass(root, 'ohne-chips-dropdown-visible'), false);
    });
  });
});
