import { formatClock } from '../../utils/duration/format-clock.ts';
import { isNull } from '../../utils/is/is-null.ts';
import { isUndefined } from '../../utils/is/is-undefined.ts';
import { onCleanup } from '../../utils/reactive/effect-scope.ts';
import { effect } from '../../utils/reactive/effect.ts';
import { ref } from '../../utils/reactive/ref.ts';
import { css } from '../render/css.ts';
import { h } from '../render/h.ts';
import './tokens.ts';

/**
 * Options for `elapsed`.
 */
export interface ElapsedOptions {
  /**
   * Size step of the component: -2 very small, -1 small, 0 default, 1 large, 2 very large.
   * Omitted inherits `--ohne-size` from the nearest ancestor.
   */
  size?: number;
}

css`
  .ohne-elapsed {
    font-size: calc(1rem + var(--ohne-size) * 0.125rem);
    font-variant-numeric: tabular-nums;
  }
`;

/**
 * A running clock of the time since a moment, such as a call's answer, in a `<time>` element.
 * It reads `m:ss`, then `h:mm:ss` from one hour on, and ticks every second.
 * While `since()` is `null` it stays empty and the tick stops.
 *
 * @example
 * ```ts
 * elapsed(() => call.value.answeredAt, { size: 1 })
 * ```
 */
export function elapsed(since: () => number | null, options: ElapsedOptions = {}): HTMLElement {
  const now = ref(Date.now());
  let timer: ReturnType<typeof setInterval> | undefined;
  const stop = (): void => {
    clearInterval(timer);
    timer = undefined;
  };

  effect(() => {
    if (isNull(since())) return stop();
    now.value = Date.now();
    timer ??= setInterval(() => {
      now.value = Date.now();
    }, 1000);
  });
  onCleanup(stop);

  const span = (): number | null => {
    const start = since();
    return isNull(start) ? null : Math.max(0, now.value - start);
  };
  return h(
    'time',
    {
      class: 'ohne-elapsed',
      style: isUndefined(options.size) ? undefined : `--ohne-size: ${options.size}`,
      datetime: () => {
        const ms = span();
        return isNull(ms) ? undefined : `PT${Math.floor(ms / 1000)}S`;
      },
    },
    () => {
      const ms = span();
      return isNull(ms) ? '' : formatClock(ms);
    },
  );
}
