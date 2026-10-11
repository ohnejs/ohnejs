import { strictEqual } from 'node:assert';
import { before, describe, it } from 'node:test';

import { flush } from '../../../src/utils/reactive/_scheduler.ts';
import { ref } from '../../../src/utils/reactive/ref.ts';
import { FakeElement, findElement, hasClass } from '../_fake-dom.ts';

const { list } = await import('../../../src/dashboard/ui/list.ts');

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

interface Raid {
  id: number;
  name: string;
}

function rows(element: FakeElement): FakeElement[] {
  const ul = findElement(element, (el) => el.tagName === 'UL');
  return (ul?.childNodes ?? []).filter(
    (node): node is FakeElement => node instanceof FakeElement && hasClass(node, 'ohne-list-row'),
  );
}

describe('list', () => {
  it('moves from placeholders to rows to the empty state', () => {
    const raids = ref<Raid[] | undefined>(undefined);
    let renders = 0;
    const element = list(
      () => raids.value,
      (raid) => {
        renders++;
        return () => raid().name;
      },
      { key: (raid) => raid.id, empty: 'No raids' },
    ) as unknown as FakeElement;
    const loading = findElement(element, (el) => el.tagName === 'UL')!;
    strictEqual(loading.getAttribute('aria-busy'), 'true');
    strictEqual(rows(element).length, 3);

    raids.value = [
      { id: 1, name: 'Molten Core' },
      { id: 2, name: 'Karazhan' },
    ];
    flush();
    strictEqual(rows(element).length, 2);
    strictEqual(element.textContent, 'Molten CoreKarazhan');

    raids.value = [
      { id: 2, name: 'Karazhan' },
      { id: 1, name: 'Molten Core' },
    ];
    flush();
    strictEqual(element.textContent, 'KarazhanMolten Core');
    strictEqual(renders, 2);

    raids.value = [];
    flush();
    strictEqual(
      findElement(element, (el) => el.tagName === 'UL'),
      undefined,
    );
    strictEqual(element.textContent, 'No raids');
  });

  it('falls back to the default empty text', () => {
    const element = list(
      () => [],
      () => null,
      { key: () => 0 },
    ) as unknown as FakeElement;
    strictEqual(element.textContent, 'Nothing here yet');
  });
});
