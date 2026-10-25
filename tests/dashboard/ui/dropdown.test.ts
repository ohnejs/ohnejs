import { deepStrictEqual, strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import type { Child } from '../../../src/dashboard/render/insert.ts';
import type { DropdownOptions } from '../../../src/dashboard/ui/dropdown.ts';

import { effectScope } from '../../../src/utils/reactive/effect-scope.ts';
import { FakeElement, findElement, hasClass } from '../_fake-dom.ts';
import { bubble, fire, trackRowFocus } from './_events.ts';

const { dropdown } = await import('../../../src/dashboard/ui/dropdown.ts');
const { dropdownItem } = await import('../../../src/dashboard/ui/dropdown-item.ts');

const body = (): FakeElement => document.body as unknown as FakeElement;

/**
 * Mounts a dropdown on the body and waits until it listens for outside presses.
 */
async function mounted(
  options: DropdownOptions = {},
  content: Child = 'Ulduar',
  parent: FakeElement = body(),
): Promise<{ root: FakeElement; closes: () => number; dispose(): void }> {
  let count = 0;
  let root!: FakeElement;
  const scope = effectScope(true);
  scope.run(() => {
    root = dropdown(content, { ...options, onClose: () => (count += 1) })
      .root as unknown as FakeElement;
    Object.defineProperties(root, { offsetWidth: { value: 200 }, offsetHeight: { value: 100 } });
    parent.appendChild(root);
  });
  await new Promise((resolve) => setTimeout(resolve));
  await new Promise((resolve) => setTimeout(resolve));
  return { root, closes: () => count, dispose: () => scope.dispose() };
}

/**
 * Dropdown rows labelled `labels`, the ones listed in `disabled` marked so.
 */
function rows(labels: string[], disabled: string[] = []): HTMLElement[] {
  return labels.map((label) => {
    const row = dropdownItem(label);
    if (disabled.includes(label)) row.setAttribute('aria-disabled', 'true');
    return row;
  });
}

const focused = (): string | undefined =>
  (document.activeElement as HTMLElement | null)?.textContent;

Object.assign(document.documentElement, { clientWidth: 1000, clientHeight: 800 });
trackRowFocus();

describe('dropdown', () => {
  it('closes on an outside right-click and keeps the native menu shut', async () => {
    const { closes, dispose } = await mounted();
    const event = fire(body(), 'contextmenu', { target: new FakeElement('main') });
    deepStrictEqual([closes(), event.defaultPrevented], [1, true]);
    dispose();
  });

  it('closes on an outside click and leaves the click alone', async () => {
    const { closes, dispose } = await mounted();
    const event = fire(body(), 'click', { target: new FakeElement('main') });
    deepStrictEqual([closes(), event.defaultPrevented], [1, false]);
    dispose();
  });

  it('closes on Escape and marks it handled, so no page hotkey takes it', async () => {
    const { closes, dispose } = await mounted();
    const event = fire(body(), 'keydown', { key: 'Escape', code: 'Escape' });
    deepStrictEqual([closes(), event.defaultPrevented, event.propagationStopped], [1, true, false]);
    dispose();
  });

  it('opens with its corner at a point reference', async () => {
    const { root, dispose } = await mounted({ reference: { clientX: 120, clientY: 80 } });
    deepStrictEqual([root.style.left, root.style.top], ['120px', '84px']);
    dispose();
  });

  it('opens below a point reference whenever it fits, even with more room above', async () => {
    const { root, dispose } = await mounted({ reference: { clientX: 120, clientY: 500 } });
    deepStrictEqual([root.style.left, root.style.top], ['120px', '504px']);
    dispose();
  });

  it('takes the first corner that fits under `firstFit`, even below an element with more room above', async () => {
    const button = new FakeElement('button');
    Object.assign(button, {
      getBoundingClientRect: () => ({ x: 120, y: 500, width: 40, height: 20 }),
    });
    const roomiest = await mounted({ reference: button as unknown as HTMLElement });
    const first = await mounted({ reference: button as unknown as HTMLElement, firstFit: true });
    deepStrictEqual([roomiest.root.style.top, first.root.style.top], ['396px', '524px']);
    roomiest.dispose();
    first.dispose();
  });

  it('flips its corner to stay inside the viewport near a point reference', async () => {
    const { root, dispose } = await mounted({ reference: { clientX: 950, clientY: 780 } });
    deepStrictEqual([root.style.left, root.style.top], ['750px', '676px']);
    dispose();
  });

  it('observes an element reference for resizes, and never a point', async () => {
    const observed: unknown[] = [];
    const Observer = globalThis.ResizeObserver;
    globalThis.ResizeObserver = class extends Observer {
      override observe(target: Element): void {
        observed.push(target);
        super.observe(target);
      }
    };
    const button = new FakeElement('button');
    const point = { clientX: 120, clientY: 80 };
    const atElement = await mounted({ reference: button as unknown as HTMLElement });
    const atPoint = await mounted({ reference: point });
    globalThis.ResizeObserver = Observer;
    deepStrictEqual([observed.includes(button), observed.includes(point)], [true, false]);
    atElement.dispose();
    atPoint.dispose();
  });

  it('focuses the panel on open, and the first enabled row when asked', async () => {
    const panel = await mounted({}, rows(['Ulduar', 'Naxxramas']));
    strictEqual(document.activeElement, panel.root);
    panel.dispose();
    const first = await mounted(
      { focusFirstRow: true },
      rows(['Ulduar', 'Naxxramas', 'Karazhan'], ['Ulduar']),
    );
    strictEqual(focused(), 'Naxxramas');
    first.dispose();
  });

  it('moves focus to the first row on Home and the last on End', async () => {
    const { dispose } = await mounted({}, rows(['Ulduar', 'Naxxramas', 'Karazhan'], ['Karazhan']));
    const end = fire(body(), 'keydown', { key: 'End', code: 'End' });
    const atEnd = focused();
    const home = fire(body(), 'keydown', { key: 'Home', code: 'Home' });
    deepStrictEqual(
      [atEnd, focused(), end.defaultPrevented, home.defaultPrevented],
      ['Karazhan', 'Ulduar', true, true],
    );
    dispose();
  });

  it('returns focus once it closes, unless an action already moved focus elsewhere', async () => {
    const trigger = new FakeElement('button');
    (trigger as unknown as HTMLElement).focus();
    const panel = await mounted({}, rows(['Ulduar']));
    panel.dispose();
    await new Promise((resolve) => setTimeout(resolve));
    strictEqual(document.activeElement, trigger);
    const again = await mounted({}, rows(['Ulduar']));
    const field = Object.assign(new FakeElement('input'), { isConnected: true });
    again.dispose();
    (field as unknown as HTMLElement).focus();
    await new Promise((resolve) => setTimeout(resolve));
    strictEqual(document.activeElement, field);
  });

  it('returns focus to the trigger even when its hosting popup took focus meanwhile', async () => {
    const popup = Object.assign(document.createElement('div'), { isConnected: true });
    popup.classList.add('ohne-popup');
    body().appendChild(popup as unknown as FakeElement);
    const trigger = document.createElement('button');
    popup.appendChild(trigger);
    trigger.focus();
    const panel = await mounted({}, rows(['Ulduar']), popup as unknown as FakeElement);
    popup.focus();
    panel.dispose();
    await new Promise((resolve) => setTimeout(resolve));
    strictEqual(document.activeElement, trigger);
    popup.remove();
  });

  it('gives focus back without scrolling it into view', async () => {
    const trigger = document.createElement('div');
    body().appendChild(trigger as unknown as FakeElement);
    trigger.focus();
    const calls: unknown[] = [];
    Object.assign(trigger, {
      focus(options?: FocusOptions) {
        calls.push(options);
        Object.assign(document, { activeElement: trigger });
      },
    });
    const panel = await mounted({}, rows(['Ulduar']));
    panel.dispose();
    await new Promise((resolve) => setTimeout(resolve));
    deepStrictEqual(calls, [{ preventScroll: true }]);
    trigger.remove();
  });

  it('keeps a right-click inside the panel from its host, and the native menu shut', async () => {
    const host = document.createElement('section');
    document.body.appendChild(host);
    const hosted: string[] = [];
    host.addEventListener('contextmenu', () => hosted.push('host'));
    const fake = host as unknown as FakeElement;
    const { root, closes, dispose } = await mounted({}, rows(['Ulduar']), fake);
    const row = findElement(root, (element) => hasClass(element, 'ohne-dropdown-item'))!;
    const event = bubble([row, root, fake, body()], 'contextmenu', { target: row });
    deepStrictEqual([event.defaultPrevented, hosted, closes()], [true, [], 0]);
    dispose();
    host.remove();
  });
});
