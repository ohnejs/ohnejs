import { type Ref, ref } from '../../utils/reactive/ref.ts';

let now: Ref<number> | undefined;

/**
 * Returns the reactive current time in epoch milliseconds, a process-wide singleton.
 * The first call starts the one interval that advances it every 30 seconds.
 * Reading `.value` inside a reactive render subscribes to it, so a relative time string stays fresh.
 * Read it from a text-only function child: a tick then patches the text node alone.
 * A region holding an element would rebuild it on every tick, disposing an open tooltip mid-hover.
 *
 * @example
 * ```ts
 * h('span', null, () => formatRelativeTime(record._updatedAt, useNow().value, 'en'))
 * ```
 */
export function useNow(): Ref<number> {
  return (now ??= start());
}

/**
 * A ref of the current time, advanced by an interval that runs for the rest of the session.
 */
function start(): Ref<number> {
  const clock = ref(Date.now());
  setInterval(() => {
    clock.value = Date.now();
  }, 30_000);
  return clock;
}
