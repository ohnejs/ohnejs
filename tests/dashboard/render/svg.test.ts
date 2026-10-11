import { strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { flush } from '../../../src/utils/reactive/_scheduler.ts';
import { ref } from '../../../src/utils/reactive/ref.ts';
import { type FakeElement } from '../_fake-dom.ts';

const { svg } = await import('../../../src/dashboard/render/svg.ts');

describe('svg', () => {
  it('sets each attribute it is given and leaves an undefined one out', () => {
    const line = svg('line', {
      x1: 0,
      x2: 10,
      class: 'axis',
      dy: undefined,
    }) as unknown as FakeElement;
    strictEqual(line.tagName, 'LINE');
    strictEqual(line.getAttribute('x2'), '10');
    strictEqual(line.getAttribute('class'), 'axis');
    strictEqual(line.attributes.has('dy'), false);
  });

  it('appends children as `h` does, text and reactive ones included', () => {
    const label = ref('Gold');
    const root = svg(
      'svg',
      {},
      svg('text', {}, () => label.value),
      'tail',
    ) as unknown as FakeElement;
    strictEqual(root.textContent, 'Goldtail');
    label.value = 'Honor';
    flush();
    strictEqual(root.textContent, 'Honortail');
  });
});
