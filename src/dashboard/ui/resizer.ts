import type { Ref } from '../../utils/reactive/ref.ts';

import { clamp } from '../../utils/number/clamp.ts';
import { onCleanup } from '../../utils/reactive/effect-scope.ts';
import { ref } from '../../utils/reactive/ref.ts';
import { untracked } from '../../utils/reactive/untracked.ts';
import { css } from '../render/css.ts';
import { h } from '../render/h.ts';
import { icon } from './icon.ts';
import './tokens.ts';

/**
 * Options for `resizer`.
 */
export interface ResizerOptions {
  /**
   * The side of the positioned parent element where the resizer strip sits.
   *
   * @default
   * 'bottom'
   */
  side?: 'top' | 'right' | 'bottom' | 'left';

  /**
   * The minimum model value.
   *
   * @default
   * 0
   */
  min?: number;

  /**
   * The maximum model value, read reactively at each drag step.
   * Omitted leaves the value unbounded.
   */
  max?: () => number;

  /**
   * The number of pixels the model changes per pixel of pointer movement.
   *
   * @default
   * 1
   */
  increment?: number;

  /**
   * Size step of the component: -2 very small, -1 small, 0 default, 1 large, 2 very large.
   * Omitted inherits `--ohne-size` from the nearest ancestor.
   */
  size?: number;

  /**
   * Called once when a drag ends, with the last dragged value, for history or persistence.
   */
  onCommit?: (value: number) => void;
}

css`
  .ohne-resizer {
    position: absolute;
    z-index: var(--ohne-z, 1);
    background-color: transparent;
    font-size: calc(1rem + var(--ohne-size) * 0.125rem);
  }

  body.ohne-resizing {
    user-select: none;
  }

  body.ohne-resizing iframe {
    pointer-events: none;
  }

  .ohne-resizer-top,
  .ohne-resizer-bottom {
    right: 0;
    left: 0;
    width: 100%;
    height: 6px;
    cursor: ns-resize;
  }

  .ohne-resizer-left,
  .ohne-resizer-right {
    top: 0;
    bottom: 0;
    width: 6px;
    height: 100%;
    cursor: ew-resize;
  }

  .ohne-resizer-top {
    top: -3px;
  }

  .ohne-resizer-right {
    right: -3px;
  }

  .ohne-resizer-bottom {
    bottom: -3px;
  }

  .ohne-resizer-left {
    left: -3px;
  }

  .ohne-resizer-handle {
    position: absolute;
    top: 50%;
    left: 50%;
    display: flex;
    justify-content: center;
    align-items: center;
    background-color: hsl(var(--ohne-primary));
    border-radius: calc(var(--ohne-radius) - 0.125rem);
    color: hsl(var(--ohne-primary-foreground));
    opacity: 0;
    visibility: hidden;
    transform: translate3d(-50%, -50%, 0) scale(0.88);
    transition: var(--ohne-transition);
    transition-property: opacity, visibility, transform;
  }

  .ohne-resizer-top .ohne-resizer-handle,
  .ohne-resizer-bottom .ohne-resizer-handle {
    width: 1.5em;
    height: 1em;
  }

  .ohne-resizer-left .ohne-resizer-handle,
  .ohne-resizer-right .ohne-resizer-handle {
    width: 1em;
    height: 1.5em;
  }

  .ohne-resizer:hover .ohne-resizer-handle,
  .ohne-resizer-active .ohne-resizer-handle {
    opacity: 1;
    visibility: visible;
    transform: translate3d(-50%, -50%, 0) scale(1);
  }
`;

/**
 * A 6px drag strip that straddles one edge of a positioned parent, driving a numeric size model.
 * Dragging writes the model continuously; releasing calls `onCommit` once with the final value.
 * Escape, mouseup, and touchend all end the drag.
 * A `body.ohne-resizing` class suppresses text selection and iframe pointer events for the duration.
 * A movement-free click still commits the last dragged value.
 *
 * @example
 * ```ts
 * const width = ref(272)
 * panel.append(resizer(width, { side: 'right', min: 272 }))
 * ```
 */
export function resizer(model: Ref<number>, options: ResizerOptions = {}): HTMLElement {
  const side = options.side ?? 'bottom';
  const isActive = ref(false);
  const stops: (() => void)[] = [];

  let tmp = untracked(() => model.value);

  const handler = (event: MouseEvent | TouchEvent): void => {
    event.preventDefault();

    const direction = side === 'top' || side === 'bottom' ? 'vertical' : 'horizontal';
    const clientX = event instanceof MouseEvent ? event.clientX : event.touches[0]?.clientX;
    const clientY = event instanceof MouseEvent ? event.clientY : event.touches[0]?.clientY;

    if (clientX === undefined || clientY === undefined) return;

    isActive.value = true;
    document.body.classList.add('ohne-resizing');

    let prev = direction === 'horizontal' ? clientX : clientY;

    const onMove = (event: MouseEvent | TouchEvent): void => {
      const clientX = event instanceof MouseEvent ? event.clientX : event.touches[0]?.clientX;
      const clientY = event instanceof MouseEvent ? event.clientY : event.touches[0]?.clientY;

      if (clientX !== undefined && clientY !== undefined) {
        const current = direction === 'horizontal' ? clientX : clientY;
        const delta = side === 'top' || side === 'left' ? prev - current : current - prev;
        const deltaRounded = delta < 0 ? Math.floor(delta) : Math.ceil(delta);
        prev = current;
        tmp = clamp(
          model.value + deltaRounded * (options.increment ?? 1),
          options.min ?? 0,
          options.max?.() ?? Infinity,
        );
        model.value = tmp;
      }
    };

    const onEscape = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') stopDragging();
    };

    document.addEventListener('mousemove', onMove);
    document.addEventListener('touchmove', onMove);
    document.addEventListener('mouseup', stopDragging);
    document.addEventListener('touchend', stopDragging);
    window.addEventListener('keydown', onEscape);
    stops.push(
      () => document.removeEventListener('mousemove', onMove),
      () => document.removeEventListener('touchmove', onMove),
      () => document.removeEventListener('mouseup', stopDragging),
      () => document.removeEventListener('touchend', stopDragging),
      () => window.removeEventListener('keydown', onEscape),
    );
  };

  const releaseDrag = (): void => {
    for (const stop of stops) stop();
    stops.length = 0;
    isActive.value = false;
    document.body.classList.remove('ohne-resizing');
  };

  const stopDragging = (): void => {
    releaseDrag();
    options.onCommit?.(tmp);
  };

  // A drag interrupted by unmount releases its listeners and body state without committing.
  onCleanup(releaseDrag);

  return h(
    'div',
    {
      class: () =>
        `ohne-resizer ohne-resizer-${side}` + (isActive.value ? ' ohne-resizer-active' : ''),
      style: options.size === undefined ? undefined : `--ohne-size: ${options.size}`,
      onMousedown: handler,
      onTouchstart: handler,
    },
    h(
      'span',
      { class: 'ohne-resizer-handle' },
      icon(side === 'left' || side === 'right' ? 'grip-vertical' : 'grip-horizontal'),
    ),
  );
}
