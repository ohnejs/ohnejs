import type { Placement } from './floater-place.ts';

import { isFunction } from '../../utils/is/is-function.ts';
import { isUndefined } from '../../utils/is/is-undefined.ts';
import { clamp } from '../../utils/number/clamp.ts';
import { batchedEffect } from '../../utils/reactive/batched-effect.ts';
import { h } from '../render/h.ts';
import { placeFloating } from './floater-place.ts';
import { placeFixed, raiseToTopLayer } from './overlay.ts';
import './tokens.ts';

/**
 * Options for `attachTooltip`.
 */
export interface TooltipOptions {
  /**
   * The preferred placement; the tooltip flips to the opposite side when starved for space.
   *
   * @default
   * 'top'
   */
  placement?: Placement;

  /**
   * The gap between the element and the tooltip.
   *
   * @default
   * 10
   */
  offset?: number;

  /**
   * The tooltip's maximum width in pixels.
   *
   * @default
   * 320
   */
  maxWidth?: number;

  /**
   * Whether any click hides the tooltip.
   * Live-updating tooltips pass `false` to survive clicks.
   *
   * @default
   * true
   */
  hideOnClick?: boolean;

  /**
   * The destructive theme, for warning and error hints.
   * Omitted, the tooltip renders in the primary colors.
   */
  theme?: 'destructive';
}

const INLINE = /\*\*(.+?)\*\*|`([^`]+)`/g;

let touchTracked = false;
let usingTouch = false;
let lastMouseMove = 0;

/**
 * Flags touch input from a touch start until two mouse moves land within 20ms; installs its listener once.
 */
function trackTouch(): void {
  if (touchTracked) return;
  touchTracked = true;
  const onMouseMove = (): void => {
    const now = performance.now();
    if (now - lastMouseMove < 20) {
      usingTouch = false;
      window.removeEventListener('mousemove', onMouseMove);
    }
    lastMouseMove = now;
  };
  window.addEventListener(
    'touchstart',
    () => {
      usingTouch = true;
      window.addEventListener('mousemove', onMouseMove);
    },
    { capture: true, passive: true },
  );
}

/**
 * Replaces `target`'s children with markdown-lite `text`: `**bold**`, backticked code, and `<br>` breaks.
 */
function renderContent(target: HTMLElement, text: string): void {
  target.textContent = '';
  text.split('<br>').forEach((line, index) => {
    if (index > 0) target.append(document.createElement('br'));
    let cursor = 0;
    for (const token of line.matchAll(INLINE)) {
      if (token.index > cursor) target.append(line.slice(cursor, token.index));
      const inline = document.createElement(isUndefined(token[1]) ? 'code' : 'strong');
      inline.textContent = token[1] ?? token[2]!;
      target.append(inline);
      cursor = token.index + token[0].length;
    }
    if (cursor < line.length) target.append(line.slice(cursor));
  });
}

/**
 * Attaches a tooltip to an element; returns the dispose.
 *
 * Show and hide are instant, any click hides, and touch shows only while holding.
 * Every tooltip is raised to the top layer as it appears, so it covers the surface that opened it.
 * The content string speaks markdown-lite: `**bold**`, backticked code, and `<br>` breaks.
 * It renders as constructed text nodes, so caller content never reaches `innerHTML`.
 * A getter as `content` re-renders reactively while visible.
 * A getter returning empty shows nothing; one turning empty while visible keeps the last content.
 * Dispose in `onCleanup` when the element's region unmounts.
 *
 * @example
 * ```ts
 * const dispose = attachTooltip(button, 'Copy `id` to clipboard')
 * onCleanup(dispose)
 * ```
 */
export function attachTooltip(
  el: HTMLElement,
  content: string | (() => string | null),
  options: TooltipOptions = {},
): () => void {
  trackTouch();
  let dismiss: (() => void) | null = null;

  const show = (): void => {
    if (dismiss) return;
    const initial = isFunction<() => string | null>(content) ? content() : content;
    if (!initial) return;
    const contentEl = h('div', { class: 'ohne-tooltip-content' });
    const arrowEl = h('div', { class: 'ohne-tooltip-arrow', style: 'position: absolute;' });
    const box = h(
      'div',
      {
        class: 'ohne-tooltip',
        'data-state': 'visible',
        'data-placement': options.placement ?? 'top',
        'data-theme': options.theme,
        style: `max-width: ${options.maxWidth ?? 320}px;`,
      },
      contentEl,
      arrowEl,
    );
    const root = h(
      'div',
      { class: 'ohne-tooltip-root', style: 'position: fixed; top: 0; left: 0;' },
      box,
    );
    renderContent(contentEl, initial);
    document.body.append(root);
    raiseToTopLayer(root);

    const update = (): void => {
      const rect = el.getBoundingClientRect();
      const placed = placeFloating({
        reference: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
        floating: { width: root.offsetWidth, height: root.offsetHeight },
        viewport: {
          width: document.documentElement.clientWidth,
          height: document.documentElement.clientHeight,
        },
        placement: options.placement ?? 'top',
        flip: true,
        offset: options.offset ?? 10,
      });
      placeFixed(root, placed.x, placed.y);
      box.setAttribute('data-placement', placed.placement);
      if (placed.placement.startsWith('top') || placed.placement.startsWith('bottom')) {
        arrowEl.style.top = '';
        arrowEl.style.left = `${clamp(
          placed.arrowOffset - arrowEl.offsetWidth / 2,
          0,
          root.offsetWidth - arrowEl.offsetWidth,
        )}px`;
      } else {
        arrowEl.style.left = '';
        arrowEl.style.top = `${clamp(
          placed.arrowOffset - arrowEl.offsetHeight / 2,
          0,
          root.offsetHeight - arrowEl.offsetHeight,
        )}px`;
      }
    };
    update();

    const onDocumentMouseDown = (): void => hide();
    window.addEventListener('scroll', update, { capture: true, passive: true });
    window.addEventListener('resize', update);
    if (options.hideOnClick !== false) {
      document.addEventListener('mousedown', onDocumentMouseDown, { capture: true });
    }
    const stopLive = isFunction<() => string | null>(content)
      ? batchedEffect(() => {
          const next = content();
          if (next) {
            renderContent(contentEl, next);
            update();
          }
        })
      : undefined;

    dismiss = () => {
      stopLive?.();
      window.removeEventListener('scroll', update, { capture: true });
      window.removeEventListener('resize', update);
      document.removeEventListener('mousedown', onDocumentMouseDown, { capture: true });
      root.remove();
      dismiss = null;
    };
  };

  const hide = (): void => dismiss?.();
  const onMouseEnter = (): void => {
    if (!usingTouch) show();
  };
  const onTouchStart = (): void => show();

  el.addEventListener('mouseenter', onMouseEnter);
  el.addEventListener('mouseleave', hide);
  el.addEventListener('focus', onMouseEnter);
  el.addEventListener('blur', hide);
  el.addEventListener('touchstart', onTouchStart, { passive: true });
  el.addEventListener('touchend', hide);
  el.addEventListener('touchcancel', hide);

  return () => {
    el.removeEventListener('mouseenter', onMouseEnter);
    el.removeEventListener('mouseleave', hide);
    el.removeEventListener('focus', onMouseEnter);
    el.removeEventListener('blur', hide);
    el.removeEventListener('touchstart', onTouchStart);
    el.removeEventListener('touchend', hide);
    el.removeEventListener('touchcancel', hide);
    hide();
  };
}
