import { deepStrictEqual } from 'node:assert';
import { describe, it } from 'node:test';

const listeners = new Map<string, () => void>();
const viewport = {
  height: 800,
  offsetTop: 0,
  scale: 1,
  addEventListener: (type: string, listener: () => void) => listeners.set(type, listener),
};
const properties = new Map<string, string>();

Object.assign(globalThis, {
  window: { innerHeight: 800, visualViewport: viewport },
  document: {
    documentElement: {
      style: {
        setProperty: (name: string, value: string) => properties.set(name, value),
        removeProperty: (name: string) => properties.delete(name),
      },
    },
  },
});

const { trackVisualViewport } = await import('../../../src/dashboard/ui/_visual-viewport.ts');

/**
 * Moves the stubbed visual viewport and fires its `type` event.
 */
function move(type: string, next: Partial<typeof viewport>): void {
  Object.assign(viewport, next);
  listeners.get(type)!();
}

describe('trackVisualViewport', () => {
  it('writes the keyboard inset and the visible area only while a keyboard covers the page', () => {
    trackVisualViewport();
    trackVisualViewport();
    deepStrictEqual([...properties], []);
    move('resize', { height: 460 });
    deepStrictEqual(Object.fromEntries(properties), {
      '--ohne-keyboard-inset': '340px',
      '--ohne-viewport-height': '460px',
      '--ohne-viewport-top': '0px',
    });
    move('scroll', { offsetTop: 120 });
    deepStrictEqual(properties.get('--ohne-keyboard-inset'), '220px');
    deepStrictEqual(properties.get('--ohne-viewport-top'), '120px');
    move('resize', { height: 800, offsetTop: 0 });
    deepStrictEqual([...properties], []);
  });

  it('ignores a pinch zoom', () => {
    move('resize', { height: 400, scale: 2 });
    deepStrictEqual([...properties], []);
  });
});
