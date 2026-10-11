import { deepStrictEqual, notStrictEqual, strictEqual } from 'node:assert';
import { describe, it, mock } from 'node:test';

import { flush } from '../../../src/utils/reactive/_scheduler.ts';
import { type FakeElement, findElement } from '../_fake-dom.ts';
import { fire } from './_events.ts';

const { copyButton } = await import('../../../src/dashboard/ui/copy-button.ts');

const fake = (element: HTMLElement): FakeElement => element as unknown as FakeElement;
const shape = (root: HTMLElement): unknown =>
  (
    findElement(fake(root), (element) => element.tagName === 'SVG') as unknown as {
      innerHTML: string;
    }
  ).innerHTML;

const clipboard = (writeText: (text: string) => Promise<void>): void => {
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
};

describe('copyButton', () => {
  it('names itself after its label', () => {
    const root = copyButton('For the Horde!');
    const named = copyButton('For the Horde!', { label: 'Copy the battle cry' });
    flush();
    strictEqual(root.getAttribute('aria-label'), 'Copy');
    strictEqual(named.getAttribute('aria-label'), 'Copy the battle cry');
  });

  it('copies the text and shows a check until the timer runs out', async () => {
    mock.timers.enable({ apis: ['setTimeout'] });
    try {
      const written: string[] = [];
      clipboard(async (text) => {
        written.push(text);
      });
      const root = copyButton(() => 'For the Horde!');
      flush();
      const resting = shape(root);
      fire(fake(root), 'click');
      await Promise.resolve();
      flush();
      deepStrictEqual(written, ['For the Horde!']);
      notStrictEqual(shape(root), resting);
      mock.timers.tick(1500);
      flush();
      strictEqual(shape(root), resting);
    } finally {
      mock.timers.reset();
    }
  });

  it('keeps the copy icon when the clipboard refuses', async () => {
    clipboard(() => Promise.reject(new Error('denied')));
    const root = copyButton('For the Horde!');
    flush();
    const resting = shape(root);
    fire(fake(root), 'click');
    await Promise.resolve();
    flush();
    strictEqual(shape(root), resting);
  });
});
