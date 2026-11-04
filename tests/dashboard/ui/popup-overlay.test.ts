import { strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import type { PopupClose } from '../../../src/dashboard/ui/popup-overlay.ts';

import { flush } from '../../../src/utils/reactive/_scheduler.ts';
import { effectScope } from '../../../src/utils/reactive/effect-scope.ts';
import { type FakeElement, findElement, hasClass } from '../_fake-dom.ts';
import { seedMessages } from '../_fake-messages.ts';
import { fire } from './_events.ts';

await seedMessages({ 'app.rename': 'Rename `Horde`' });

const { popup } = await import('../../../src/dashboard/ui/popup-overlay.ts');

const open = (...args: Parameters<typeof popup>): FakeElement => {
  const root = effectScope().run(() => popup(...args).root);
  flush();
  return root as unknown as FakeElement;
};

const header = (root: FakeElement): FakeElement | undefined =>
  findElement(root, (el) => hasClass(el, 'ohne-popup-header'));

const closeButton = (root: FakeElement): FakeElement | undefined =>
  findElement(header(root)!, (el) => el.tagName === 'BUTTON');

describe('popup title', () => {
  it('builds a header with the title and a close button that asks `onClose`', () => {
    let asked: PopupClose | undefined;
    const root = open('body', { title: 'app.rename', onClose: (close) => (asked = close) });
    const title = findElement(root, (el) => hasClass(el, 'ohne-popup-title'))!;
    strictEqual(title.textContent, 'Rename Horde');
    strictEqual(findElement(title, (el) => el.tagName === 'CODE')?.textContent, 'Horde');
    fire(closeButton(root)!, 'click');
    strictEqual(typeof asked, 'function');
  });

  it('leaves the close button out without an `onClose`', () => {
    strictEqual(closeButton(open('body', { title: 'app.rename' })), undefined);
  });

  it('gives way to a `header`', () => {
    const root = open('body', { title: 'app.rename', header: 'Own' });
    strictEqual(header(root)?.textContent, 'Own');
  });

  it('builds no header without either', () => {
    strictEqual(header(open('body')), undefined);
  });
});
