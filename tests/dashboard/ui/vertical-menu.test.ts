import { deepStrictEqual, strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { flush } from '../../../src/utils/reactive/_scheduler.ts';
import { ref } from '../../../src/utils/reactive/ref.ts';
import { type FakeElement, findElement, hasClass } from '../_fake-dom.ts';

const { verticalMenu } = await import('../../../src/dashboard/ui/vertical-menu.ts');

describe('verticalMenu', () => {
  it('follows an expand label getter', () => {
    const label = ref('Expand');
    const root = verticalMenu({
      items: () => [{ label: 'Posts', submenu: [{ label: 'Drafts', to: '/drafts' }] }],
      ariaExpandLabel: () => label.value,
    }) as unknown as FakeElement;
    flush();
    const button = findElement(root, (element) => element.attributes.has('aria-expanded'));
    strictEqual(button?.getAttribute('aria-label'), 'Expand');
    label.value = 'Ausklappen';
    flush();
    strictEqual(button?.getAttribute('aria-label'), 'Ausklappen');
  });

  it("follows an expand label getter on a link's own toggle", () => {
    const label = ref('Expand');
    const root = verticalMenu({
      items: () => [
        { label: 'Posts', to: '/posts', submenu: [{ label: 'Drafts', to: '/drafts' }] },
      ],
      ariaExpandLabel: () => label.value,
    }) as unknown as FakeElement;
    flush();
    const button = findElement(root, (element) => element.attributes.has('aria-expanded'));
    strictEqual(button?.getAttribute('aria-label'), 'Expand');
    label.value = 'Ausklappen';
    flush();
    strictEqual(button?.getAttribute('aria-label'), 'Ausklappen');
  });

  it('keeps an expanded state under each item id, so it follows a reorder', () => {
    const items = ref([
      { id: 'posts', label: 'Posts', submenu: [{ label: 'Drafts', to: '/drafts' }] },
      { id: 'pages', label: 'Pages', submenu: [{ label: 'Home', to: '/' }] },
    ]);
    const root = verticalMenu({
      items: () => items.value,
      expandedState: ref<Record<string, boolean>>({ pages: true }),
    }) as unknown as FakeElement;
    const expanded = () =>
      findElement(root, (element) => hasClass(element, 'ohne-vertical-menu-item-expanded'))
        ?.textContent;
    flush();
    strictEqual(expanded(), 'PagesHome');
    items.value = [items.value[1], items.value[0]];
    flush();
    strictEqual(expanded(), 'PagesHome');
  });

  it('expands every ancestor of an active row, hyphens in their ids included', () => {
    const expandedState = ref<Record<string, boolean>>({});
    verticalMenu({
      items: () => [
        {
          id: 'site-content',
          label: 'Content',
          submenu: [
            {
              id: 'blog-posts',
              label: 'Posts',
              submenu: [{ id: 'drafts', label: 'Drafts', to: '/drafts', active: true }],
            },
          ],
        },
      ],
      expandedState,
    });
    flush();
    deepStrictEqual(expandedState.value, {
      'site-content': true,
      'blog-posts': true,
      drafts: true,
    });
  });
});
