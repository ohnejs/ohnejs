import { strictEqual } from 'node:assert';
import { before, describe, it } from 'node:test';

import { flush } from '../../../src/utils/reactive/_scheduler.ts';
import { ref } from '../../../src/utils/reactive/ref.ts';
import { type FakeElement, findElement, hasClass } from '../_fake-dom.ts';

const { statusBadge, statusDot } = await import('../../../src/dashboard/ui/status.ts');

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

const DEPLOY = {
  queued: { tone: 'neutral', label: 'Queued' },
  live: { tone: 'success', label: 'Live', icon: 'circle-check' },
} as const;

function fake(element: HTMLElement): FakeElement {
  return element as unknown as FakeElement;
}

function badgeOf(element: FakeElement): FakeElement {
  return findElement(element, (el) => hasClass(el, 'ohne-badge'))!;
}

describe('statusBadge', () => {
  it('shows the mapped state as a soft badge with a dot', () => {
    const badge = badgeOf(fake(statusBadge('queued', DEPLOY)));
    strictEqual(badge.getAttribute('class'), 'ohne-badge ohne-badge-soft ohne-tone-neutral');
    strictEqual(badge.textContent, 'Queued');
    strictEqual(hasClass(badge.childNodes[0] as FakeElement, 'ohne-badge-dot'), true);
  });

  it('follows the state and leads with its icon instead of the dot', () => {
    const state = ref<keyof typeof DEPLOY>('queued');
    const element = fake(statusBadge(() => state.value, DEPLOY));
    state.value = 'live';
    flush();
    const badge = badgeOf(element);
    strictEqual(hasClass(badge, 'ohne-tone-success'), true);
    strictEqual((badge.childNodes[0] as FakeElement).tagName, 'SVG');
    strictEqual(badge.textContent, 'Live');
  });
});

describe('statusDot', () => {
  it('names the dot by its state and follows it', () => {
    const state = ref<'on' | 'off' | 'idle'>('on');
    const element = fake(statusDot(() => state.value));
    const mark = findElement(element, (el) => hasClass(el, 'ohne-status-dot-mark'))!;
    strictEqual(hasClass(element, 'ohne-tone-success'), true);
    strictEqual(mark.getAttribute('role'), 'img');
    strictEqual(mark.getAttribute('aria-label'), 'On');
    state.value = 'idle';
    flush();
    strictEqual(hasClass(element, 'ohne-tone-warning'), true);
    strictEqual(mark.getAttribute('aria-label'), 'Idle');
    state.value = 'off';
    flush();
    strictEqual(hasClass(element, 'ohne-tone-neutral'), true);
  });

  it('shows a label beside the dot', () => {
    strictEqual(fake(statusDot('off', { label: 'Queue worker' })).textContent, 'Queue worker');
  });
});
