import type { Child } from '../render/insert.ts';

import { clamp } from '../../utils/number/clamp.ts';
import { onCleanup } from '../../utils/reactive/effect-scope.ts';
import { css } from '../render/css.ts';
import { h } from '../render/h.ts';
import { acquireEscapeLayer } from './layers.ts';
import './tokens.ts';

/**
 * Options for `popover`.
 */
export interface PopoverOptions {
  /**
   * The element the popover hugs.
   */
  anchor: HTMLElement;

  /**
   * Called on Escape or a pointerdown outside both anchor and popover.
   */
  onClose(): void;

  /**
   * Match the anchor's width as the panel's minimum.
   *
   * @default
   * true
   */
  matchWidth?: boolean;

  /**
   * Extra class names appended to the panel's own.
   */
  class?: string;
}

css`
  .ohne-popover {
    position: fixed;
    z-index: 15;
    box-sizing: border-box;
    max-width: 400px;
    overflow-y: auto;
    background: var(--raised);
    border: 1px solid var(--line-strong);
    border-radius: var(--radius);
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.32);
  }
`;

/**
 * An anchored floating panel, portaled to `document.body`.
 * It hugs the anchor from below, flips above when starved for space, and re-measures on scroll and resize.
 * Escape and a pointerdown outside both anchor and panel ask it to close; nothing else does.
 * Focus never moves into the panel - the anchor keeps it.
 *
 * Returns `null`: the panel lives in `body`, not in the caller's tree.
 * Must be called inside a reactive scope.
 * The panel, its listeners, and its Escape layer all release when the owning region unmounts.
 *
 * @example
 * ```ts
 * when(() => open.value, () =>
 *   popover({ anchor: input, onClose: () => (open.value = false) }, list),
 * )
 * ```
 */
export function popover(options: PopoverOptions, ...content: Child[]): Child {
  const panel = h(
    'div',
    { class: `ohne-popover${options.class ? ` ${options.class}` : ''}` },
    ...content,
  );
  document.body.append(panel);
  const place = (): void => {
    const rect = options.anchor.getBoundingClientRect();
    if (options.matchWidth !== false) panel.style.minWidth = `${Math.max(rect.width, 260)}px`;
    const below = window.innerHeight - rect.bottom - 4;
    const above = rect.top - 4;
    const up = below < Math.min(280, panel.scrollHeight) && above > below;
    panel.style.maxHeight = `${Math.max((up ? above : below) - 8, 0)}px`;
    if (up) {
      panel.style.top = 'auto';
      panel.style.bottom = `${window.innerHeight - rect.top + 4}px`;
    } else {
      panel.style.bottom = 'auto';
      panel.style.top = `${rect.bottom + 4}px`;
    }
    // Measured at the left edge, or the viewport's right edge would squeeze the natural width.
    panel.style.left = '0px';
    panel.style.left = `${clamp(rect.left, 8, window.innerWidth - panel.offsetWidth - 8)}px`;
  };
  place();
  // The caller usually creates the panel in the same render pass that mounts the anchor, so the
  // first measure can see a detached anchor; a microtask later both stand in the document.
  queueMicrotask(place);
  const onPointerDown = (event: PointerEvent): void => {
    const target = event.target;
    if (target instanceof Node && (options.anchor.contains(target) || panel.contains(target)))
      return;
    options.onClose();
  };
  document.addEventListener('pointerdown', onPointerDown, { capture: true });
  window.addEventListener('scroll', place, { capture: true });
  window.addEventListener('resize', place);
  const release = acquireEscapeLayer(() => options.onClose());
  onCleanup(() => {
    release();
    document.removeEventListener('pointerdown', onPointerDown, { capture: true });
    window.removeEventListener('scroll', place, { capture: true });
    window.removeEventListener('resize', place);
    panel.remove();
  });
  return null;
}
