import { strictEqual } from 'node:assert';
import { beforeEach, describe, it, mock } from 'node:test';

import { ref } from '../../../src/utils/reactive/ref.ts';
import './_events.ts';

const { contextMenu } = await import('../../../src/dashboard/ui/context-menu.ts');

type Listener = (event: unknown) => void;

function surface(): { target: EventTarget; fire(type: string, event: unknown): void } {
  const listeners = new Map<string, Set<Listener>>();
  const target = {
    addEventListener: (type: string, listener: Listener) => {
      listeners.set(type, (listeners.get(type) ?? new Set()).add(listener));
    },
    removeEventListener: (type: string, listener: Listener) =>
      listeners.get(type)?.delete(listener),
  } as unknown as EventTarget;
  return {
    target,
    fire: (type, event) => {
      for (const listener of listeners.get(type) ?? []) listener(event);
    },
  };
}

function touchEvent(target: EventTarget, points: { clientX: number; clientY: number }[]) {
  const event = {
    target,
    touches: points,
    prevented: false,
    stopped: false,
    preventDefault: () => {
      event.prevented = true;
    },
    stopPropagation: () => {
      event.stopped = true;
    },
  };
  return event;
}

function setup() {
  const event = ref<MouseEvent | TouchEvent | null>(null);
  const menu = contextMenu(event, null, { touchDuration: 500 });
  const { target, fire } = surface();
  const start = touchEvent(target, [{ clientX: 10, clientY: 10 }]);
  const end = touchEvent(target, []);
  return {
    event,
    menu,
    fire,
    start,
    end,
    down: () => menu.onTouchStart(start as unknown as TouchEvent),
    up: () => menu.onTouchEnd(end as unknown as TouchEvent),
    move: (clientX: number, clientY: number) =>
      fire('touchmove', touchEvent(target, [{ clientX, clientY }])),
  };
}

describe('contextMenu long-press', () => {
  beforeEach(() => {
    mock.timers.reset();
    mock.timers.enable({ apis: ['setTimeout'] });
  });

  it('opens on a still hold and swallows the release click', () => {
    const s = setup();
    s.down();
    mock.timers.tick(500);
    strictEqual(s.event.value, s.start);
    s.up();
    strictEqual(s.end.prevented, true);
    s.event.value = null;
  });

  it('keeps the release click of a short tap', () => {
    const s = setup();
    s.down();
    mock.timers.tick(200);
    s.up();
    mock.timers.tick(500);
    strictEqual(s.event.value, null);
    strictEqual(s.end.prevented, false);
  });

  it('keeps the hold through a jitter within the slop', () => {
    const s = setup();
    s.down();
    s.move(14, 16);
    mock.timers.tick(500);
    strictEqual(s.event.value, s.start);
    s.event.value = null;
  });

  it('drops the hold once the finger scrolls away', () => {
    const s = setup();
    s.down();
    s.move(10, 40);
    mock.timers.tick(500);
    strictEqual(s.event.value, null);
    s.up();
    strictEqual(s.end.prevented, false);
  });

  it('drops the hold on a touchcancel', () => {
    const s = setup();
    s.down();
    s.fire('touchcancel', {});
    mock.timers.tick(500);
    strictEqual(s.event.value, null);
  });

  it('drops the hold when a second finger lands', () => {
    const s = setup();
    s.down();
    const pinch = touchEvent(s.start.target, [
      { clientX: 10, clientY: 10 },
      { clientX: 60, clientY: 60 },
    ]);
    s.menu.onTouchStart(pinch as unknown as TouchEvent);
    mock.timers.tick(500);
    strictEqual(s.event.value, null);
  });

  it('swallows a native long-press contextmenu once the hold opened the menu', () => {
    const s = setup();
    s.down();
    mock.timers.tick(500);
    const native = touchEvent(s.start.target, []);
    s.menu.onContextMenu(native as unknown as MouseEvent);
    strictEqual(native.prevented, true);
    strictEqual(native.stopped, true);
    strictEqual(s.event.value, s.start);
    s.event.value = null;
  });

  it('lets a native contextmenu during the hold open the menu once', () => {
    const s = setup();
    s.down();
    mock.timers.tick(200);
    const native = touchEvent(s.start.target, []);
    s.menu.onContextMenu(native as unknown as MouseEvent);
    mock.timers.tick(500);
    strictEqual(s.event.value, native);
    s.up();
    strictEqual(s.end.prevented, true);
    s.event.value = null;
  });

  it('opens on every right-click without a touch in play', () => {
    const s = setup();
    const click = touchEvent(s.start.target, []);
    s.menu.onContextMenu(click as unknown as MouseEvent);
    strictEqual(click.prevented, true);
    strictEqual(click.stopped, false);
    strictEqual(s.event.value, click);
    s.event.value = null;
  });
});
