import { strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { flush } from '../../../src/utils/reactive/_scheduler.ts';
import { ref } from '../../../src/utils/reactive/ref.ts';
import { type FakeElement, findElement } from '../_fake-dom.ts';

const { avatar } = await import('../../../src/dashboard/ui/avatar.ts');

function fake(element: HTMLElement): FakeElement {
  return element as unknown as FakeElement;
}

describe('avatar', () => {
  it('shows the initials on a chart color the name picks', () => {
    const element = fake(avatar('Anduin Wrynn'));
    strictEqual(element.textContent, 'AW');
    strictEqual(element.getAttribute('role'), 'img');
    strictEqual(element.getAttribute('aria-label'), 'Anduin Wrynn');
    strictEqual(element.getAttribute('style'), '--ohne-avatar: var(--ohne-chart-3)');
  });

  it('gives one name the same color every time', () => {
    strictEqual(
      fake(avatar('Thrall')).getAttribute('style'),
      fake(avatar('Thrall')).getAttribute('style'),
    );
  });

  it('pins the size step', () => {
    strictEqual(
      fake(avatar('Thrall', { size: 2 })).getAttribute('style'),
      '--ohne-avatar: var(--ohne-chart-1); --ohne-size: 2',
    );
  });

  it('swaps between the image and the initials as the source changes', () => {
    const src = ref<string | undefined>('/thrall.png');
    const element = fake(avatar('Thrall', { src: () => src.value }));
    const image = findElement(element, (el) => el.tagName === 'IMG')!;
    strictEqual(image.getAttribute('src'), '/thrall.png');
    strictEqual(image.getAttribute('alt'), '');
    src.value = undefined;
    flush();
    strictEqual(
      findElement(element, (el) => el.tagName === 'IMG'),
      undefined,
    );
    strictEqual(element.textContent, 'T');
  });
});
