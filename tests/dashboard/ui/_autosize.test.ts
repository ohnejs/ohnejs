import { strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import '../_fake-dom.ts';

const { autosizeTextarea } = await import('../../../src/dashboard/ui/_autosize.ts');

/**
 * A textarea of `content` px inside a wrapper, at the bottom of a pane of `viewport` px scrolled to its end.
 * Reading `scrollHeight` lays out: the pane clamps `scrollTop` to whatever the wrapper is tall right then.
 */
function layout(content: number, above: number, viewport: number) {
  const pane = { scrollTop: 0 };
  const parent = {
    isConnected: true,
    style: { minHeight: '' },
    get offsetHeight() {
      return Math.max(
        Number.parseFloat(parent.style.minHeight) || 0,
        Number.parseFloat(area.style.height),
      );
    },
  };
  const area = {
    parentElement: parent,
    style: { height: `${content}px` },
    get scrollHeight() {
      pane.scrollTop = Math.min(
        pane.scrollTop,
        Math.max(0, above + parent.offsetHeight - viewport),
      );
      return content;
    },
  };
  pane.scrollTop = above + content - viewport;
  return { pane, parent, area };
}

describe('autosizeTextarea', () => {
  it('keeps the scroll pane still while it measures', () => {
    const { pane, area } = layout(1500, 400, 900);
    autosizeTextarea(area as unknown as HTMLTextAreaElement)();
    strictEqual(pane.scrollTop, 1000);
  });

  it('sizes the textarea to its content', () => {
    const { area } = layout(1500, 0, 900);
    autosizeTextarea(area as unknown as HTMLTextAreaElement)();
    strictEqual(area.style.height, '1500px');
  });

  it('restores the inline min-height of the parent', () => {
    const { parent, area } = layout(1500, 0, 900);
    parent.style.minHeight = '2rem';
    autosizeTextarea(area as unknown as HTMLTextAreaElement)();
    strictEqual(parent.style.minHeight, '2rem');
  });

  it('waits for the textarea to be mounted', () => {
    const { area } = layout(1500, 0, 900);
    Object.assign(area, { parentElement: null });
    autosizeTextarea(area as unknown as HTMLTextAreaElement)();
    strictEqual(area.style.height, '1500px');
  });
});
