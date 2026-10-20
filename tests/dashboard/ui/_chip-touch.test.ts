import { deepStrictEqual } from 'node:assert';
import { describe, it, mock } from 'node:test';

import { chipTouch } from '../../../src/dashboard/ui/_chip-touch.ts';
import { effectScope } from '../../../src/utils/reactive/effect-scope.ts';

/**
 * A touch event at `y` and `timeStamp` that records whether its default was prevented.
 */
const touchAt = (y: number, timeStamp = 0) => {
  const event = {
    touches: [{ clientX: 0, clientY: y }],
    timeStamp,
    prevented: false,
    preventDefault: () => (event.prevented = true),
  };
  return event as typeof event & TouchEvent & MouseEvent;
};

/**
 * Wires `chipTouch` with fake timers, logging each hold and double tap into `calls`.
 */
function wired(): {
  touch: ReturnType<typeof chipTouch>;
  calls: string[];
  scope: { dispose(): void };
} {
  mock.timers.enable({ apis: ['setTimeout'] });
  const calls: string[] = [];
  const scope = effectScope();
  const touch = scope.run(() =>
    chipTouch(
      500,
      () => calls.push('hold'),
      () => calls.push('double'),
    ),
  ) as ReturnType<typeof chipTouch>;
  return { touch, calls, scope };
}

describe('chipTouch', () => {
  it('holds after a still press and cancels the mouse events of its release', (t) => {
    t.after(() => mock.timers.reset());
    const { touch, calls } = wired();
    touch.onTouchstart(touchAt(0));
    mock.timers.tick(500);
    const end = touchAt(0, 600);
    touch.onTouchend(end);
    deepStrictEqual([calls, end.prevented], [['hold'], true]);
  });

  it('leaves a tap whose touchstart a child kept, like a remove button, to that child', (t) => {
    const { touch, scope } = wired();
    t.after(() => (mock.timers.reset(), scope.dispose()));
    touch.onTouchstart(touchAt(10));
    mock.timers.tick(500);
    touch.onTouchend(touchAt(10));
    const childTap = touchAt(10);
    touch.onTouchend(childTap);
    deepStrictEqual(childTap.prevented, false);
  });

  it('drops the hold once the finger moves past the slop, so the swipe scrolls', (t) => {
    t.after(() => mock.timers.reset());
    const { touch, calls } = wired();
    const start = touchAt(0);
    touch.onTouchstart(start);
    touch.onTouchmove(touchAt(4));
    touch.onTouchmove(touchAt(40));
    mock.timers.tick(500);
    const end = touchAt(40, 600);
    touch.onTouchend(end);
    deepStrictEqual([calls, start.prevented, end.prevented], [[], false, false]);
  });

  it('drops the hold on a cancelled touch', (t) => {
    t.after(() => mock.timers.reset());
    const { touch, calls } = wired();
    touch.onTouchstart(touchAt(0));
    touch.onTouchcancel();
    mock.timers.tick(500);
    deepStrictEqual(calls, []);
  });

  it('calls a second tap within 300ms a double tap', (t) => {
    t.after(() => mock.timers.reset());
    const { touch, calls } = wired();
    touch.onTouchstart(touchAt(0, 0));
    touch.onTouchend(touchAt(0, 50));
    touch.onTouchstart(touchAt(0, 150));
    const second = touchAt(0, 200);
    touch.onTouchend(second);
    deepStrictEqual([calls, second.prevented], [['double'], true]);
  });

  it('keeps taps 300ms or more apart single', (t) => {
    t.after(() => mock.timers.reset());
    const { touch, calls } = wired();
    touch.onTouchstart(touchAt(0, 0));
    touch.onTouchend(touchAt(0, 50));
    touch.onTouchstart(touchAt(0, 300));
    touch.onTouchend(touchAt(0, 350));
    deepStrictEqual(calls, []);
  });

  it('never pairs a swipe with a tap', (t) => {
    t.after(() => mock.timers.reset());
    const { touch, calls } = wired();
    touch.onTouchstart(touchAt(0, 0));
    touch.onTouchend(touchAt(0, 50));
    touch.onTouchstart(touchAt(0, 100));
    touch.onTouchmove(touchAt(30, 120));
    touch.onTouchend(touchAt(30, 150));
    deepStrictEqual(calls, []);
  });

  it('keeps the long-press menu shut only while a touch is down', (t) => {
    t.after(() => mock.timers.reset());
    const { touch } = wired();
    touch.onTouchstart(touchAt(0));
    const during = touchAt(0);
    touch.onContextmenu(during);
    touch.onTouchend(touchAt(0, 600));
    const after = touchAt(0);
    touch.onContextmenu(after);
    deepStrictEqual([during.prevented, after.prevented], [true, false]);
  });

  it('clears a pending hold when its scope is disposed', (t) => {
    t.after(() => mock.timers.reset());
    const { touch, calls, scope } = wired();
    touch.onTouchstart(touchAt(0));
    scope.dispose();
    mock.timers.tick(500);
    deepStrictEqual(calls, []);
  });
});
