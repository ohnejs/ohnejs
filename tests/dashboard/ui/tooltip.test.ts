import { strictEqual } from 'node:assert';
import { beforeEach, describe, it } from 'node:test';

import { FakeElement, findElement, hasClass } from '../_fake-dom.ts';
import { fire } from './_events.ts';

const { append } = FakeElement.prototype as unknown as { append: (...nodes: unknown[]) => void };
Object.assign(FakeElement.prototype, {
  append(this: FakeElement, ...nodes: unknown[]) {
    const text = (node: unknown): unknown =>
      typeof node === 'string' ? document.createTextNode(node) : node;
    append.call(this, ...nodes.map(text));
  },
});

const { attachTooltip } = await import('../../../src/dashboard/ui/tooltip.ts');

type Listener = (event: unknown) => void;
const global = new Map<string, Set<Listener>>();
const listen = (type: string, listener: Listener): void => {
  global.set(type, (global.get(type) ?? new Set()).add(listener));
};
const unlisten = (type: string, listener: Listener): void =>
  void global.get(type)?.delete(listener);
const dispatch = (type: string, init: Record<string, unknown> = {}): void => {
  for (const listener of global.get(type) ?? []) listener({ type, ...init });
};

Object.assign(window, { addEventListener: listen, removeEventListener: unlisten });
Object.assign(document, { addEventListener: listen, removeEventListener: unlisten });

const shown = (): boolean =>
  !!findElement(document.body as unknown as FakeElement, (element) =>
    hasClass(element, 'ohne-tooltip-root'),
  );

const host = (): FakeElement => {
  const element = document.createElement('span') as unknown as FakeElement;
  Object.assign(element, { contains: (node: unknown) => node === element });
  return element;
};

beforeEach(() => {
  (document.body as unknown as FakeElement).replaceChildren();
  global.clear();
});

describe('attachTooltip', () => {
  it('shows on touch only while the finger holds', () => {
    const el = host();
    attachTooltip(el as unknown as HTMLElement, 'Bank snapshot');
    fire(el, 'touchstart');
    strictEqual(shown(), true);
    fire(el, 'touchend');
    strictEqual(shown(), false);
  });

  it('pins on a tap with `tap`, past the compatibility mousedown', () => {
    const el = host();
    attachTooltip(el as unknown as HTMLElement, 'Bank snapshot', { tap: true });
    fire(el, 'touchstart');
    fire(el, 'touchend');
    dispatch('mousedown', { target: el });
    strictEqual(shown(), true);
  });

  it('toggles closed on a second tap of the element', () => {
    const el = host();
    attachTooltip(el as unknown as HTMLElement, 'Bank snapshot', { tap: true });
    fire(el, 'touchstart');
    fire(el, 'touchend');
    dispatch('pointerdown', { pointerType: 'touch', target: el });
    strictEqual(shown(), true);
    fire(el, 'touchstart');
    strictEqual(shown(), false);
  });

  it('hides a pinned tooltip on a tap elsewhere', () => {
    const el = host();
    attachTooltip(el as unknown as HTMLElement, 'Bank snapshot', { tap: true });
    fire(el, 'touchstart');
    dispatch('pointerdown', { pointerType: 'touch', target: document.body });
    strictEqual(shown(), false);
  });

  it('hides a pinned tooltip on scroll', () => {
    const el = host();
    attachTooltip(el as unknown as HTMLElement, 'Bank snapshot', { tap: true });
    fire(el, 'touchstart');
    dispatch('scroll');
    strictEqual(shown(), false);
  });

  it('keeps a hovered tooltip through a scroll, and a click hides it', () => {
    const el = host();
    attachTooltip(el as unknown as HTMLElement, 'Bank snapshot', { tap: true });
    fire(el, 'mouseenter');
    dispatch('scroll');
    strictEqual(shown(), true);
    dispatch('mousedown', { target: el });
    strictEqual(shown(), false);
  });
});
