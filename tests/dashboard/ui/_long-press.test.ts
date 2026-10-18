import { deepStrictEqual } from 'node:assert';
import { describe, it, mock } from 'node:test';

import { longPress, TOUCH_SLOP } from '../../../src/dashboard/ui/_long-press.ts';
import { effectScope } from '../../../src/utils/reactive/effect-scope.ts';

const at = (clientX: number, clientY: number) => ({ clientX, clientY });

/**
 * Wires `longPress` with fake timers, counting its holds.
 */
function wired(): { press: ReturnType<typeof longPress>; holds: () => number; dispose(): void } {
  mock.timers.enable({ apis: ['setTimeout'] });
  let count = 0;
  const scope = effectScope();
  const press = scope.run(() => longPress(500, () => (count += 1)))!;
  return { press, holds: () => count, dispose: () => scope.dispose() };
}

describe('longPress', () => {
  it('holds after a still press, and reports it on release', (t) => {
    t.after(() => mock.timers.reset());
    const { press, holds } = wired();
    press.start(at(0, 0));
    press.move(at(3, 3));
    mock.timers.tick(500);
    deepStrictEqual([holds(), press.held(), press.end()], [1, true, true]);
  });

  it('drops the hold once the finger drifts past the slop', (t) => {
    t.after(() => mock.timers.reset());
    const { press, holds } = wired();
    press.start(at(0, 0));
    press.move(at(0, TOUCH_SLOP + 1));
    mock.timers.tick(500);
    deepStrictEqual([holds(), press.pending(), press.end()], [0, false, false]);
  });

  it('drops the hold on an early release', (t) => {
    t.after(() => mock.timers.reset());
    const { press, holds } = wired();
    press.start(at(0, 0));
    deepStrictEqual([press.pending(), press.end()], [true, false]);
    mock.timers.tick(500);
    deepStrictEqual(holds(), 0);
  });

  it('forgets the last hold on the next start', (t) => {
    t.after(() => mock.timers.reset());
    const { press } = wired();
    press.start(at(0, 0));
    mock.timers.tick(500);
    press.end();
    press.start(at(0, 0));
    deepStrictEqual(press.held(), false);
  });

  it('drops a pending hold when its scope is disposed', (t) => {
    t.after(() => mock.timers.reset());
    const { press, holds, dispose } = wired();
    press.start(at(0, 0));
    dispose();
    mock.timers.tick(500);
    deepStrictEqual(holds(), 0);
  });
});
