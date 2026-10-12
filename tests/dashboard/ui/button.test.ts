import { strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { flush } from '../../../src/utils/reactive/_scheduler.ts';
import { ref } from '../../../src/utils/reactive/ref.ts';
import { type FakeElement, findElement, hasClass } from '../_fake-dom.ts';
import './_events.ts';

const { button } = await import('../../../src/dashboard/ui/button.ts');
const { icon } = await import('../../../src/dashboard/ui/icon.ts');

const fake = (element: HTMLElement): FakeElement => element as unknown as FakeElement;

describe('button', () => {
  it('renders a Text label in its label span', () => {
    const root = button('Summon', { icon: 'plus' });
    flush();
    strictEqual(
      findElement(fake(root), (element) => hasClass(element, 'ohne-button-label'))?.textContent,
      'Summon',
    );
    strictEqual(root.getAttribute('aria-label'), null);
  });

  it('keeps a getter label live in its label span, beside the icon', () => {
    const locked = ref(true);
    const root = button(() => (locked.value ? 'Unlock' : 'Lock'), { icon: 'lock' });
    flush();
    const label = (): string | undefined =>
      findElement(fake(root), (element) => hasClass(element, 'ohne-button-label'))?.textContent;
    strictEqual(label(), 'Unlock');
    locked.value = false;
    flush();
    strictEqual(label(), 'Lock');
  });

  it('keeps a getter child bare without a leading icon, so a lone icon stays icon-only', () => {
    const root = button(() => icon('copy'), { ariaLabel: 'Copy' });
    flush();
    strictEqual(
      findElement(fake(root), (element) => hasClass(element, 'ohne-button-label')),
      undefined,
    );
  });

  it('sets the real disabled attribute on a button', () => {
    const disabled = ref(true);
    const root = button('Summon', { disabled: () => disabled.value });
    flush();
    strictEqual(root.getAttribute('disabled'), '');
    strictEqual(root.getAttribute('aria-disabled'), null);
    disabled.value = false;
    flush();
    strictEqual(root.getAttribute('disabled'), null);
  });

  it('disables a link through aria-disabled and the tab order', () => {
    const root = button('Open', { href: '/raids', disabled: () => true });
    flush();
    strictEqual(root.tagName, 'A');
    strictEqual(root.getAttribute('disabled'), null);
    strictEqual(root.getAttribute('aria-disabled'), 'true');
    strictEqual(root.getAttribute('tabindex'), '-1');
  });

  it('is busy and disabled while loading, with a spinner for the icon', () => {
    const loading = ref(true);
    const root = button('Save', { icon: 'device-floppy', loading: () => loading.value });
    flush();
    strictEqual(root.getAttribute('aria-busy'), 'true');
    strictEqual(root.getAttribute('disabled'), '');
    const svg = (): FakeElement | undefined =>
      findElement(fake(root), (element) => element.tagName === 'SVG');
    strictEqual(svg()?.classList.has('ohne-button-spinner'), true);
    loading.value = false;
    flush();
    strictEqual(root.getAttribute('aria-busy'), null);
    strictEqual(svg()?.classList.has('ohne-button-spinner'), false);
  });

  it('names an always icon-only button by its label and drops the label text', () => {
    const root = button('Delete', { icon: 'trash', iconOnly: true });
    flush();
    strictEqual(root.getAttribute('aria-label'), 'Delete');
    strictEqual(root.textContent, '');
  });

  it('keeps the label of a stepped icon-only button for wide containers', () => {
    const root = button('Export', { icon: 'download', iconOnly: 'sm' });
    flush();
    strictEqual(hasClass(fake(root), 'ohne-button-icon-only-sm'), true);
    strictEqual(root.getAttribute('aria-label'), 'Export');
    strictEqual(root.textContent, 'Export');
  });

  it('resolves a Text aria label', () => {
    const root = button('x', { ariaLabel: () => 'Close the portal' });
    flush();
    strictEqual(root.getAttribute('aria-label'), 'Close the portal');
  });
});
