import { strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { lockScroll } from '../../../src/dashboard/ui/_scroll-lock.ts';

function element(overflow = '') {
  return { style: { overflow } };
}

describe('lockScroll', () => {
  it('holds until the last overlapping lock releases, first in first out', () => {
    const el = element();
    const unlockFirst = lockScroll(el);
    const unlockSecond = lockScroll(el);
    unlockFirst();
    strictEqual(el.style.overflow, 'hidden');
    unlockSecond();
    strictEqual(el.style.overflow, '');
  });

  it('holds until the last overlapping lock releases, last in first out', () => {
    const el = element();
    const unlockFirst = lockScroll(el);
    const unlockSecond = lockScroll(el);
    unlockSecond();
    strictEqual(el.style.overflow, 'hidden');
    unlockFirst();
    strictEqual(el.style.overflow, '');
  });

  it('restores the inline overflow the first lock found', () => {
    const el = element('auto');
    const unlockFirst = lockScroll(el);
    const unlockSecond = lockScroll(el);
    unlockFirst();
    unlockSecond();
    strictEqual(el.style.overflow, 'auto');
  });

  it('ignores a repeated release while another lock holds', () => {
    const el = element();
    const unlockFirst = lockScroll(el);
    const unlockSecond = lockScroll(el);
    unlockFirst();
    unlockFirst();
    strictEqual(el.style.overflow, 'hidden');
    unlockSecond();
    strictEqual(el.style.overflow, '');
  });

  it('locks separate elements independently', () => {
    const page = element();
    const pane = element();
    const unlockPage = lockScroll(page);
    const unlockPane = lockScroll(pane);
    unlockPage();
    strictEqual(page.style.overflow, '');
    strictEqual(pane.style.overflow, 'hidden');
    unlockPane();
    strictEqual(pane.style.overflow, '');
  });
});
