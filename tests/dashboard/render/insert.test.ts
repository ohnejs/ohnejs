import { strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { append } from '../../../src/dashboard/render/insert.ts';
import { flush } from '../../../src/utils/reactive/_scheduler.ts';
import { ref } from '../../../src/utils/reactive/ref.ts';
import { FakeNode, FakeText } from '../_fake-dom.ts';

describe('insert', () => {
  it('patches untracked, so a handler that a leaving node fires cannot subscribe the region', () => {
    const root = new FakeNode();
    const shown = ref('a');
    const focus = ref(0);
    let runs = 0;
    append(root as unknown as Node, () => {
      runs++;
      const node = new FakeText(shown.value);
      // A focused node that leaves fires `blur` at once, and its handler reads state.
      node.remove = () => {
        void focus.value;
        FakeText.prototype.remove.call(node);
      };
      return node as unknown as Node;
    });
    shown.value = 'b';
    flush();
    const settled = runs;
    focus.value = 1;
    flush();
    strictEqual(root.textContent, 'b');
    strictEqual(runs, settled);
  });
});
