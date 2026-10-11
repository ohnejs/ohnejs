import { strictEqual } from 'node:assert';
import { before, describe, it } from 'node:test';

import { useDocumentTitle } from '../../../src/dashboard/runtime/title.ts';
import { effectScope } from '../../../src/utils/reactive/effect-scope.ts';
import { ref } from '../../../src/utils/reactive/ref.ts';

describe('useDocumentTitle', () => {
  before(() => {
    Object.assign(globalThis, {
      document: {
        title: '',
        getElementById: () => ({
          textContent: JSON.stringify({
            apiURL: 'http://api',
            defaultLanguage: 'en',
            messageGroups: [],
          }),
        }),
      },
    });
  });

  it('shows the newest live title and falls back as scopes end', () => {
    const page = effectScope();
    const popup = effectScope();
    page.run(() => useDocumentTitle('Posts'));
    strictEqual(document.title, 'Posts - ohne');
    popup.run(() => useDocumentTitle(() => 'Edit post'));
    strictEqual(document.title, 'Edit post - ohne');
    popup.dispose();
    strictEqual(document.title, 'Posts - ohne');
    page.dispose();
    strictEqual(document.title, 'ohne');
  });

  it('pops a title that ends below the newest, keeping the newest shown', () => {
    const below = effectScope();
    const above = effectScope();
    below.run(() => useDocumentTitle('Below'));
    above.run(() => useDocumentTitle('Above'));
    below.dispose();
    strictEqual(document.title, 'Above - ohne');
    above.dispose();
    strictEqual(document.title, 'ohne');
  });

  it('follows a getter and shows the bare name while it reads empty', () => {
    const scope = effectScope();
    const name = ref<string | undefined>(undefined);
    scope.run(() => useDocumentTitle(() => name.value));
    strictEqual(document.title, 'ohne');
    name.value = 'Hello';
    strictEqual(document.title, 'Hello - ohne');
    name.value = '';
    strictEqual(document.title, 'ohne');
    scope.dispose();
    name.value = 'Stale';
    strictEqual(document.title, 'ohne');
  });
});
