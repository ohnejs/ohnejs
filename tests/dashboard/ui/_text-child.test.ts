import { strictEqual } from 'node:assert';
import { before, describe, it } from 'node:test';

import { flush } from '../../../src/utils/reactive/_scheduler.ts';
import { ref } from '../../../src/utils/reactive/ref.ts';
import { type FakeElement, findElement, hasClass } from '../_fake-dom.ts';

const { h } = await import('../../../src/dashboard/render/h.ts');
const { inlineChild, proseChild, textChild } =
  await import('../../../src/dashboard/ui/_text-child.ts');

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

const render = (child: ReturnType<typeof textChild>): FakeElement =>
  h('div', null, child) as unknown as FakeElement;

const code = (element: FakeElement): FakeElement | undefined =>
  findElement(element, (child) => child.tagName === 'CODE');

describe('textChild', () => {
  it('strips backticks from a string and a getter', () => {
    strictEqual(render(textChild('Deploy `v2`')).textContent, 'Deploy v2');
    strictEqual(render(textChild(() => 'Deploy `v2`')).textContent, 'Deploy v2');
  });
});

describe('inlineChild', () => {
  it('shows a code span as an inline chip and follows a getter', () => {
    const name = ref('a');
    const element = render(inlineChild(() => `Site \`${name.value}\``));
    strictEqual(hasClass(code(element)!, 'ohne-inline-code'), true);
    name.value = 'b';
    flush();
    strictEqual(element.textContent, 'Site b');
    strictEqual(code(element)?.textContent, 'b');
  });

  it('renders a child that is not text as is', () => {
    strictEqual(render(inlineChild(() => 3)).textContent, '3');
  });
});

describe('proseChild', () => {
  it('renders a getter string as prose', () => {
    const element = render(proseChild(() => 'Failed for `api`'));
    strictEqual(code(element)?.textContent, 'api');
  });
});
