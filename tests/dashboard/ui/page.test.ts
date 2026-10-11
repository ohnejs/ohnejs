import { strictEqual } from 'node:assert';
import { before, describe, it } from 'node:test';

import { effectScope } from '../../../src/utils/reactive/effect-scope.ts';
import { type FakeElement, findElement } from '../_fake-dom.ts';

const { page } = await import('../../../src/dashboard/ui/page.ts');

before(() => {
  Object.assign(document, {
    title: '',
    getElementById: () => ({
      textContent: JSON.stringify({
        apiURL: 'http://api',
        defaultLanguage: 'en',
        messageGroups: [],
      }),
    }),
  });
});

const find = (element: HTMLElement, tag: string): FakeElement | undefined =>
  findElement(element as unknown as FakeElement, (child) => child.tagName === tag);

describe('page', () => {
  it('heads the content with one `h1` and names the tab while it lives', () => {
    const scope = effectScope();
    const element = scope.run(() => page({ title: 'Raid roster' }, 'Thrall'))!;
    strictEqual(find(element, 'H1')?.textContent, 'Raid roster');
    strictEqual(document.title, 'Raid roster - ohne');
    strictEqual(element.textContent, 'Raid rosterThrall');
    scope.dispose();
    strictEqual(document.title, 'ohne');
  });

  it('draws the back link, badge, description, and actions', () => {
    const scope = effectScope();
    const element = scope.run(() =>
      page({
        title: 'Thrall',
        back: '/dashboard/roster',
        badge: 'Warchief',
        description: 'Son of Durotan',
        actions: 'Edit',
      }),
    )!;
    strictEqual(find(element, 'A')?.getAttribute('href'), '/dashboard/roster');
    strictEqual(element.textContent, 'BackThrallWarchiefSon of DurotanEdit');
    scope.dispose();
  });
});
