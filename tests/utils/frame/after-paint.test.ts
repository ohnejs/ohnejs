import { deepStrictEqual } from 'node:assert';
import { afterEach, describe, it } from 'node:test';

import { afterPaint } from '../../../src/utils/index.ts';

describe('afterPaint', () => {
  afterEach(() => {
    Reflect.deleteProperty(globalThis, 'document');
    Reflect.deleteProperty(globalThis, 'requestAnimationFrame');
  });

  it('resolves at once outside a browser', async () => {
    const order: string[] = [];
    const done = afterPaint().then(() => order.push('painted'));
    setTimeout(() => order.push('task'));
    await done;
    deepStrictEqual(order, ['painted']);
  });

  it('resolves at once in a hidden tab', async () => {
    let frames = 0;
    Object.assign(globalThis, {
      document: { visibilityState: 'hidden' },
      requestAnimationFrame: () => frames++,
    });
    await afterPaint();
    deepStrictEqual(frames, 0);
  });

  it('resolves in the task after the next frame', async () => {
    const order: string[] = [];
    Object.assign(globalThis, {
      document: { visibilityState: 'visible' },
      requestAnimationFrame: (run: () => void) => {
        setTimeout(() => {
          order.push('frame');
          run();
        });
        return 1;
      },
    });
    await afterPaint().then(() => order.push('painted'));
    deepStrictEqual(order, ['frame', 'painted']);
  });
});
