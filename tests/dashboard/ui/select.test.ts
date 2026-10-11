import { strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { flush } from '../../../src/utils/reactive/_scheduler.ts';
import { ref } from '../../../src/utils/reactive/ref.ts';
import { FakeElement, type FakeNode, findElement, hasClass } from '../_fake-dom.ts';
import { seedMessages } from '../_fake-messages.ts';
import { fire } from './_events.ts';

await seedMessages({
  'app.utc': 'Coordinated time',
  'app.europe': 'Europe',
  'app.pick': 'Pick one',
});

const { select } = await import('../../../src/dashboard/ui/select.ts');

const find = (root: HTMLElement, name: string): FakeElement | undefined =>
  findElement(root as unknown as FakeElement, (el) => hasClass(el, name));

const textsOf = (node: FakeNode, name: string): string[] =>
  node.childNodes.flatMap((child) => [
    ...(child instanceof FakeElement && hasClass(child, name) ? [child.textContent] : []),
    ...textsOf(child, name),
  ]);

describe('select', () => {
  it('resolves a message key label', () => {
    const root = select(ref<string>('utc'), () => [{ value: 'utc', label: 'app.utc' }]);
    flush();
    strictEqual(find(root, 'ohne-select-selected-choice')?.textContent, 'Coordinated time');
    strictEqual(root.getAttribute('title'), 'Coordinated time');
  });

  it('keeps a getter label live', () => {
    const name = ref('Horde');
    const root = select(ref<string>('side'), () => [{ value: 'side', label: () => name.value }]);
    flush();
    name.value = 'Alliance';
    flush();
    strictEqual(find(root, 'ohne-select-selected-choice')?.textContent, 'Alliance');
  });

  it('type-ahead matches the resolved label, not the key', () => {
    const model = ref<string>('cet');
    const root = select(model, () => [
      { value: 'utc', label: 'app.utc' },
      { value: 'cet', label: 'Central European Time' },
    ]);
    flush();
    const combobox = find(root, 'ohne-select')!;
    fire(combobox, 'click');
    fire(combobox, 'keydown', { key: 'c' });
    fire(combobox, 'keydown', { key: 'o' });
    fire(combobox, 'keydown', { key: 'Enter' });
    strictEqual(model.value, 'utc');
  });

  it('resolves a message key group and keeps a getter group live', () => {
    const name = ref('Horde');
    const root = select(ref<string>('cet'), () => [
      { group: 'app.europe', choices: [{ value: 'cet', label: 'CET' }] },
      { group: () => name.value, choices: [{ value: 'org', label: 'Orgrimmar' }] },
    ]);
    flush();
    const labels = (): string[] =>
      textsOf(root as unknown as FakeElement, 'ohne-select-group-label');
    strictEqual(labels()[0], 'Europe');
    name.value = 'Alliance';
    flush();
    strictEqual(labels()[1], 'Alliance');
  });

  it('resolves a message key placeholder and keeps a getter placeholder live', () => {
    const keyed = select(ref<string | null>(null), () => [], { placeholder: 'app.pick' });
    flush();
    strictEqual(find(keyed, 'ohne-select-placeholder')?.textContent, 'Pick one');
    const name = ref('Horde');
    const live = select(ref<string | null>(null), () => [], { placeholder: () => name.value });
    flush();
    name.value = 'Alliance';
    flush();
    strictEqual(find(live, 'ohne-select-placeholder')?.textContent, 'Alliance');
  });
});
