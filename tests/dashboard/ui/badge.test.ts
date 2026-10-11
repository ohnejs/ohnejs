import { strictEqual } from 'node:assert';
import { before, describe, it } from 'node:test';

import { flush } from '../../../src/utils/reactive/_scheduler.ts';
import { ref } from '../../../src/utils/reactive/ref.ts';
import { type FakeElement, findElement, hasClass } from '../_fake-dom.ts';

const { badge } = await import('../../../src/dashboard/ui/badge.ts');

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

describe('badge', () => {
  it('defaults to a solid primary pill', () => {
    const element = fake(badge('Draft'));
    strictEqual(element.getAttribute('class'), 'ohne-badge ohne-badge-solid ohne-tone-primary');
    strictEqual(element.textContent, 'Draft');
    strictEqual(element.getAttribute('style'), null);
  });

  it('paints the tone through the variant', () => {
    const element = fake(badge('Live', { tone: 'success', variant: 'soft' }));
    strictEqual(hasClass(element, 'ohne-badge-soft'), true);
    strictEqual(hasClass(element, 'ohne-tone-success'), true);
  });

  it('leads with a dot, then an icon, then the label', () => {
    const element = fake(badge('Raid', { dot: true, icon: 'clock' }));
    const [dot, svg, label] = element.childNodes as FakeElement[];
    strictEqual(hasClass(dot!, 'ohne-badge-dot'), true);
    strictEqual(dot!.getAttribute('aria-hidden'), 'true');
    strictEqual(svg!.tagName, 'SVG');
    strictEqual(hasClass(label!, 'ohne-badge-label'), true);
  });

  it('pins the size step', () => {
    strictEqual(fake(badge('Small', { size: -2 })).getAttribute('style'), '--ohne-size: -2');
  });

  it('renders a getter child live', () => {
    const name = ref('Horde');
    const element = fake(badge(() => name.value));
    name.value = 'Alliance';
    flush();
    strictEqual(element.textContent, 'Alliance');
  });

  it('resolves a message pair', () => {
    const element = fake(badge({ key: 'Guild', params: {} }));
    strictEqual(
      findElement(element, (el) => hasClass(el, 'ohne-badge-label'))!.textContent,
      'Guild',
    );
  });
});
