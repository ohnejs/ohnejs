import { strictEqual } from 'node:assert';
import { after, before, describe, it } from 'node:test';

import { flush } from '../../../src/utils/reactive/_scheduler.ts';
import { ref } from '../../../src/utils/reactive/ref.ts';
import { type FakeElement } from '../_fake-dom.ts';

const realSetInterval = globalThis.setInterval;

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
  Object.assign(globalThis, {
    window: { addEventListener() {}, removeEventListener() {} },
    setInterval: (run: () => void, ms: number) => realSetInterval(run, ms).unref(),
  });
});

after(() => {
  globalThis.setInterval = realSetInterval;
});

const { relativeTime } = await import('../../../src/dashboard/ui/relative-time.ts');

describe('relativeTime', () => {
  it('writes the moment relative to now in a `<time>` with its ISO instant', () => {
    const at = Date.now() - 3 * 60 * 60 * 1000;
    const element = relativeTime(at) as unknown as FakeElement;
    strictEqual(element.tagName, 'TIME');
    strictEqual(element.getAttribute('datetime'), new Date(at).toISOString());
    strictEqual(element.textContent, '3 hours ago');
  });

  it('takes a `Date` and follows a getter', () => {
    const at = ref(new Date(Date.now() - 2 * 24 * 60 * 60 * 1000));
    const element = relativeTime(() => at.value) as unknown as FakeElement;
    strictEqual(element.textContent, '2 days ago');
    at.value = new Date(Date.now() - 60 * 1000);
    flush();
    strictEqual(element.textContent, '1 minute ago');
  });
});
