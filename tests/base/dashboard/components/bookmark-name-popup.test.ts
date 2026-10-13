import { deepStrictEqual, strictEqual } from 'node:assert';
import { afterEach, before, beforeEach, describe, it } from 'node:test';

import type { BookmarkNamePopupOptions } from '../../../../src/base/dashboard/components/bookmark-name-popup.ts';
import type { FakeElement } from '../../../dashboard/_fake-dom.ts';
import type { Sent } from './_popups.ts';

import { startSession } from '../../../../src/dashboard/runtime/_request.ts';
import { useResource } from '../../../../src/dashboard/runtime/resource.ts';
import { effectScope } from '../../../../src/utils/reactive/effect-scope.ts';
import { baseBrowser } from '../_browser.ts';
import {
  body,
  fire,
  idle,
  lastInput,
  recordFetch,
  recordListeners,
  textButton,
} from './_popups.ts';

const DRAFTS = { UUID: 'b-drafts', name: 'Drafts', view: '', shared: false, mine: true };

describe('bookmarkNamePopup', () => {
  let bookmarkNamePopup!: typeof import('../../../../src/base/dashboard/components/bookmark-name-popup.ts').bookmarkNamePopup;
  let outlet!: FakeElement;
  let scope: ReturnType<typeof effectScope> | undefined;
  let refusal: Record<string, string> | undefined;
  let closes = 0;
  const sent: Sent[] = [];

  /**
   * The messages of the toasts showing; a message without a catalog reads as its key.
   */
  const toasts = (): string[] =>
    outlet.childNodes
      .flatMap((list) => list.childNodes.map((item) => item.textContent))
      .filter((text) => text !== '');

  /**
   * Opens the popup for `target` beside a bookmarks list, and lets the list load.
   */
  const open = async (target: BookmarkNamePopupOptions['target']): Promise<void> => {
    scope = effectScope();
    scope.run(() => {
      const list = useResource('GET /dashboard/bookmarks/[collection]', {
        params: { collection: 'posts' },
      });
      bookmarkNamePopup({
        segment: 'posts',
        target,
        list,
        onClose: () => {
          closes += 1;
        },
      });
    });
    await idle();
  };

  /**
   * Types `text` into the name input.
   */
  const type = (text: string): void => {
    const input = lastInput();
    input.value = text;
    fire(input, 'input');
  };

  /**
   * Whether the button labelled `label` is disabled.
   */
  const disabled = (label: string): boolean => textButton(label).getAttribute('disabled') === '';

  before(async () => {
    baseBrowser('/collections/posts');
    recordListeners();
    recordFetch(sent, ({ method }) => {
      if (method === 'GET') return Response.json({ bookmarks: [], default: null });
      if (refusal === undefined) return Response.json(DRAFTS, { status: 201 });
      const data = { errors: refusal };
      return Response.json({ statusCode: 422, message: 'Invalid', data }, { status: 422 });
    });
    ({ bookmarkNamePopup } =
      await import('../../../../src/base/dashboard/components/bookmark-name-popup.ts'));
    const { toaster } = await import('../../../../src/dashboard/ui/toaster.ts');
    outlet = toaster() as unknown as FakeElement;
    startSession();
  });

  beforeEach(() => {
    sent.length = 0;
    refusal = undefined;
    closes = 0;
  });

  afterEach(() => {
    scope?.dispose();
    body().replaceChildren();
  });

  it('keeps Create disabled until the name holds more than spaces', async () => {
    await open({ view: 'order=[title]' });
    strictEqual(disabled('dashboard.create'), true);
    type('   ');
    strictEqual(disabled('dashboard.create'), true);
    type('By title');
    strictEqual(disabled('dashboard.create'), false);
  });

  it('keeps Rename disabled while the trimmed name is unchanged', async () => {
    await open({ bookmark: DRAFTS });
    strictEqual(lastInput().value, 'Drafts');
    strictEqual(disabled('dashboard.bookmarks.rename'), true);
    type(' Drafts ');
    strictEqual(disabled('dashboard.bookmarks.rename'), true);
    type('Unpublished');
    strictEqual(disabled('dashboard.bookmarks.rename'), false);
  });

  it('creates the trimmed name with the view, toasts, reloads the list, and asks to close', async () => {
    await open({ view: 'order=[title]' });
    type(' By title ');
    fire(textButton('dashboard.create'), 'click');
    await idle();
    deepStrictEqual(
      sent.map(({ method, path, body }) => [method, path, body]),
      [
        ['GET', '/dashboard/bookmarks/posts', undefined],
        ['POST', '/dashboard/bookmarks/posts', { name: 'By title', view: 'order=[title]' }],
        ['GET', '/dashboard/bookmarks/posts', undefined],
      ],
    );
    strictEqual(toasts().at(0), 'dashboard.created');
    strictEqual(closes, 1);
  });

  it('shows a refused name under the input and stays open', async () => {
    await open({ bookmark: DRAFTS });
    refusal = { name: 'Use at most 120 characters' };
    type('x'.repeat(121));
    fire(textButton('dashboard.bookmarks.rename'), 'click');
    await idle();
    deepStrictEqual(sent.at(-1)?.body, { name: 'x'.repeat(121) });
    strictEqual(body().textContent.includes('Use at most 120 characters'), true);
    strictEqual(closes, 0);
  });

  it('toasts a refused view, which no input shows', async () => {
    await open({ view: 'order=[title]' });
    refusal = { view: 'Invalid value' };
    type('By title');
    fire(textButton('dashboard.create'), 'click');
    await idle();
    strictEqual(body().textContent.includes('Invalid value'), false);
    strictEqual(
      toasts().some((text) => text.includes('Invalid value')),
      true,
    );
    strictEqual(closes, 0);
  });
});
