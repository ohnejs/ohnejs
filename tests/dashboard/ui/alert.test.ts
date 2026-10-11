import { strictEqual } from 'node:assert';
import { before, describe, it } from 'node:test';

import { flush } from '../../../src/utils/reactive/_scheduler.ts';
import { ref } from '../../../src/utils/reactive/ref.ts';
import { type FakeElement, findElement, hasClass } from '../_fake-dom.ts';

const { alert } = await import('../../../src/dashboard/ui/alert.ts');

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

function fake(element: HTMLElement): FakeElement {
  return element as unknown as FakeElement;
}

describe('alert', () => {
  it('follows a title getter', () => {
    const title = ref('Locked');
    const element = fake(alert('Body', { title: () => title.value }));
    strictEqual(element.textContent, 'LockedBody');
    title.value = 'Gesperrt';
    flush();
    strictEqual(element.textContent, 'GesperrtBody');
  });

  it('is a plain primary note by default', () => {
    const element = fake(alert('Body'));
    strictEqual(hasClass(element, 'ohne-alert-plain'), true);
    strictEqual(hasClass(element, 'ohne-tone-primary'), true);
    strictEqual(element.getAttribute('role'), 'note');
  });

  it('rings a status tone and announces the urgent ones', () => {
    const failed = fake(alert('Body', { tone: 'destructive' }));
    strictEqual(hasClass(failed, 'ohne-alert-status'), true);
    strictEqual(failed.getAttribute('role'), 'alert');
    strictEqual(fake(alert('Body', { tone: 'warning' })).getAttribute('role'), 'alert');
    strictEqual(fake(alert('Body', { tone: 'success' })).getAttribute('role'), 'note');
  });

  it('fills a surface tone', () => {
    strictEqual(hasClass(fake(alert('Body', { tone: 'neutral' })), 'ohne-alert-surface'), true);
  });

  it('draws the named icon and the actions under the content', () => {
    const element = fake(alert('Body', { icon: 'lock', actions: 'Retry' }));
    const holder = findElement(element, (el) => hasClass(el, 'ohne-alert-icon'))!;
    strictEqual((holder.childNodes[0] as FakeElement).tagName, 'SVG');
    const actions = findElement(element, (el) => hasClass(el, 'ohne-alert-actions'))!;
    strictEqual(actions.textContent, 'Retry');
  });
});
