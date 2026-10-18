import { strictEqual } from 'node:assert';
import { before, describe, it, mock } from 'node:test';

import { flush } from '../../../src/utils/reactive/_scheduler.ts';
import { ref } from '../../../src/utils/reactive/ref.ts';
import { type FakeElement, findElement } from '../_fake-dom.ts';
import './_controls.ts';

const { discovered } = await import('../../../src/dashboard/fields/_discovered.ts');
const { field } = await import('../../../src/dashboard/fields/known-field-types.ts');
const { fieldInput } = await import('../../../src/dashboard/fields/form.ts');
const { sessionUser } = await import('../../../src/dashboard/runtime/session.ts');
await import('../../../src/dashboard/fields/builtin/text.ts');

const GUEST = {
  UUID: 'u',
  email: 'thrall@example.com',
  roles: [],
  dashboardLanguage: null,
  contentLanguage: null,
  timezone: null,
  dateFormat: 'YYYY-MM-DD',
  timeFormat: 'HH:mm',
  smartClipboard: false,
};

/**
 * Lets pending fetches and their continuations settle, then runs every queued effect.
 */
async function settle(): Promise<void> {
  for (let i = 0; i < 3; i++) await new Promise((resolve) => setImmediate(resolve));
  flush();
}

/**
 * Whether `root` holds an `input` element.
 */
function hasInput(root: HTMLElement): boolean {
  return !!findElement(root as unknown as FakeElement, (element) => element.tagName === 'INPUT');
}

describe('discovered', () => {
  let answer: (() => void) | undefined;

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
    mock.method(globalThis, 'fetch', async (url: string) => {
      if (!url.endsWith('/dashboard')) return new Response(JSON.stringify(GUEST));
      await new Promise<void>((resolve) => (answer = resolve));
      return new Response(JSON.stringify({ collections: [], locales: [], menu: [] }));
    });
  });

  it('lets a field build at once without a session', () => {
    strictEqual(discovered(), true);
    strictEqual(hasInput(fieldInput(ref(''), field('text', { label: 'Leader' }))), true);
  });

  it('holds a field under a session until `GET /dashboard` answers', async () => {
    sessionUser();
    await settle();
    strictEqual(discovered(), false);
    const input = fieldInput(ref(''), field('text', { label: 'Leader' }));
    strictEqual(hasInput(input), false);
    answer?.();
    await settle();
    strictEqual(discovered(), true);
    strictEqual(hasInput(input), true);
  });
});
