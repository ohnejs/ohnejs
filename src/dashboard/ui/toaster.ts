import type { Child } from '../render/insert.ts';

import { first } from '../../utils/array/first.ts';
import { isEmpty } from '../../utils/is/is-empty.ts';
import { isUndefined } from '../../utils/is/is-undefined.ts';
import { effectScope, onCleanup } from '../../utils/reactive/effect-scope.ts';
import { effect } from '../../utils/reactive/effect.ts';
import { ref } from '../../utils/reactive/ref.ts';
import { untracked } from '../../utils/reactive/untracked.ts';
import { css } from '../render/css.ts';
import { each } from '../render/each.ts';
import { h } from '../render/h.ts';
import { useRoute } from '../router/router.ts';
import { icon, type IconName } from './icon.ts';
import { raiseToTopLayer } from './overlay.ts';
import { renderProse } from './prose.ts';
import './tokens.ts';

/**
 * The action button of a toast, rendered as a primary button after the content.
 */
export interface ToastAction {
  /**
   * The button label.
   */
  label: string;

  /**
   * Called on click; the toast dismisses afterwards unless the handler calls `preventDefault`.
   */
  onClick: (event: MouseEvent) => void;
}

/**
 * Options for `toast` and `queueToast`.
 */
export interface ToastOptions {
  /**
   * The visual style of the toast, by message importance.
   * Every type except `'default'` leads with its icon.
   * `'error'` and `'warning'` recolor to the destructive palette.
   *
   * @default
   * 'default'
   */
  type?: 'default' | 'success' | 'error' | 'info' | 'warning';

  /**
   * Controls if the message and a string `description` render as markdown-lite (see `renderProse`).
   * `false` renders them as plain text.
   *
   * @default
   * true
   */
  markdown?: boolean;

  /**
   * Whether a QUEUED toast holds until the next route change instead of showing on the next drain.
   * Only meaningful with `queueToast`.
   *
   * @default
   * false
   */
  showAfterRouteChange?: boolean;

  /**
   * A secondary line rendered under the message in a slightly smaller size.
   */
  description?: string;

  /**
   * An action button rendered after the content.
   */
  action?: ToastAction;

  /**
   * How long the toast stays, in milliseconds.
   * `Infinity` never auto-dismisses.
   *
   * @default
   * 4000
   */
  duration?: number;

  /**
   * Whether to render the close button straddling the toast's top-left corner.
   *
   * @default
   * false
   */
  closeButton?: boolean;

  /**
   * The toast id.
   * Calling `toast` again with the id of a showing toast updates it in place.
   * A toast already on its way out comes back, so the update always shows.
   * Omitted generates one.
   */
  id?: string | number;

  /**
   * Called when the toast is dismissed by the close button or a swipe.
   */
  onDismiss?: () => void;

  /**
   * Called when the toast's timer expires, right before it dismisses.
   */
  onAutoClose?: () => void;
}

interface ToastRecord {
  id: string | number;
  message: string;
  type: NonNullable<ToastOptions['type']>;
  markdown: boolean;
  description: string | undefined;
  action: ToastAction | undefined;
  duration: number;
  closeButton: boolean;
  class: string;
  onDismiss: (() => void) | undefined;
  onAutoClose: (() => void) | undefined;
}

const GAP = 8;
const VISIBLE_TOASTS = 3;
const DEFAULT_DURATION = 4000;
const REMOVE_DELAY = 200;
const SWIPE_THRESHOLD = 20;

const toasts = ref<ToastRecord[]>([]);
const dismissers = new Map<string | number, () => void>();
const heights = ref<{ toastId: string | number; height: number }[]>([]);
const queue = ref<{ message: string; options?: ToastOptions }[]>([]);

let counter = 0;
let outlet: HTMLElement | undefined;

const TYPE_ICONS: Record<Exclude<ToastRecord['type'], 'default'>, IconName> = {
  success: 'circle-check',
  error: 'exclamation-circle-filled',
  info: 'info-circle',
  warning: 'exclamation-circle',
};

const CLOSE_SHAPE = '<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>';

css`
  :where([data-sonner-toaster][dir='ltr']) {
    --toast-icon-margin-start: -3px;
    --toast-icon-margin-end: 4px;
    --toast-svg-margin-start: -1px;
    --toast-svg-margin-end: 0px;
    --toast-button-margin-start: auto;
    --toast-button-margin-end: 0;
    --toast-close-button-start: 0;
    --toast-close-button-end: unset;
    --toast-close-button-transform: translate(-35%, -35%);
  }

  :where([data-sonner-toaster]) {
    position: fixed;
    width: var(--width);
    font-family:
      ui-sans-serif,
      system-ui,
      -apple-system,
      BlinkMacSystemFont,
      Segoe UI,
      Roboto,
      Helvetica Neue,
      Arial,
      Noto Sans,
      sans-serif,
      Apple Color Emoji,
      Segoe UI Emoji,
      Segoe UI Symbol,
      Noto Color Emoji;
    --gray1: hsl(0, 0%, 99%);
    --gray2: hsl(0, 0%, 97.3%);
    --gray3: hsl(0, 0%, 95.1%);
    --gray4: hsl(0, 0%, 93%);
    --gray5: hsl(0, 0%, 90.9%);
    --gray6: hsl(0, 0%, 88.7%);
    --gray7: hsl(0, 0%, 85.8%);
    --gray8: hsl(0, 0%, 78%);
    --gray9: hsl(0, 0%, 56.1%);
    --gray10: hsl(0, 0%, 52.3%);
    --gray11: hsl(0, 0%, 43.5%);
    --gray12: hsl(0, 0%, 9%);
    --border-radius: 8px;
    box-sizing: border-box;
    padding: 0;
    margin: 0;
    list-style: none;
    outline: 0;
    z-index: 999999999;
    transition: transform 0.4s ease;
  }

  :where([data-sonner-toaster][data-lifted='true']) {
    transform: translateY(-10px);
  }

  @media (hover: none) and (pointer: coarse) {
    :where([data-sonner-toaster][data-lifted='true']) {
      transform: none;
    }
  }

  :where([data-sonner-toaster][data-x-position='right']) {
    right: max(var(--offset), env(safe-area-inset-right));
  }

  :where([data-sonner-toaster][data-x-position='left']) {
    left: max(var(--offset), env(safe-area-inset-left));
  }

  :where([data-sonner-toaster][data-x-position='center']) {
    left: 50%;
    transform: translateX(-50%);
  }

  :where([data-sonner-toaster][data-y-position='top']) {
    top: max(var(--offset), env(safe-area-inset-top));
  }

  :where([data-sonner-toaster][data-y-position='bottom']) {
    bottom: max(var(--offset), env(safe-area-inset-bottom));
  }

  :where([data-sonner-toast]) {
    --y: translateY(100%);
    --lift-amount: calc(var(--lift) * var(--gap));
    z-index: var(--z-index);
    position: absolute;
    opacity: 0;
    transform: var(--y);
    filter: blur(0);
    touch-action: none;
    transition:
      transform 0.4s,
      opacity 0.4s,
      height 0.4s,
      box-shadow 0.2s;
    box-sizing: border-box;
    outline: 0;
    overflow-wrap: anywhere;
  }

  :where([data-sonner-toast]:focus-visible) {
    box-shadow:
      0 4px 12px rgba(0, 0, 0, 0.1),
      0 0 0 2px rgba(0, 0, 0, 0.2);
  }

  :where([data-sonner-toast][data-y-position='top']) {
    top: 0;
    --y: translateY(-100%);
    --lift: 1;
    --lift-amount: calc(1 * var(--gap));
  }

  :where([data-sonner-toast][data-y-position='bottom']) {
    bottom: 0;
    --y: translateY(100%);
    --lift: -1;
    --lift-amount: calc(var(--lift) * var(--gap));
  }

  :where([data-sonner-toast]) :where([data-description]) {
    font-weight: 400;
    line-height: 1.4;
    color: inherit;
  }

  :where([data-sonner-toast]) :where([data-title]) {
    font-weight: 500;
    line-height: 1.5;
    color: inherit;
  }

  :where([data-sonner-toast]) :where([data-icon]) {
    display: flex;
    height: 16px;
    width: 16px;
    position: relative;
    justify-content: flex-start;
    align-items: center;
    flex-shrink: 0;
    margin-left: var(--toast-icon-margin-start);
    margin-right: var(--toast-icon-margin-end);
  }

  :where([data-sonner-toast]) :where([data-icon]) > * {
    flex-shrink: 0;
  }

  :where([data-sonner-toast]) :where([data-icon]) svg {
    margin-left: var(--toast-svg-margin-start);
    margin-right: var(--toast-svg-margin-end);
  }

  :where([data-sonner-toast]) :where([data-content]) {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  :where([data-sonner-toast]) :where([data-button]):focus-visible {
    box-shadow: 0 0 0 2px rgba(0, 0, 0, 0.4);
  }

  :where([data-sonner-toast]) :where([data-button]):first-of-type {
    margin-left: var(--toast-button-margin-start);
    margin-right: var(--toast-button-margin-end);
  }

  [data-sonner-toast] [data-close-button] {
    position: absolute;
    left: var(--toast-close-button-start);
    right: var(--toast-close-button-end);
    top: 0;
    height: 20px;
    width: 20px;
    display: flex;
    justify-content: center;
    align-items: center;
    padding: 0;
    background: var(--gray1);
    color: var(--gray12);
    border: 1px solid var(--gray4);
    transform: var(--toast-close-button-transform);
    border-radius: 50%;
    cursor: pointer;
    z-index: 1;
    transition:
      opacity 0.1s,
      background 0.2s,
      border-color 0.2s;
  }

  :where([data-sonner-toast]) :where([data-close-button]):focus-visible {
    box-shadow:
      0 4px 12px rgba(0, 0, 0, 0.1),
      0 0 0 2px rgba(0, 0, 0, 0.2);
  }

  [data-sonner-toast]:hover [data-close-button]:hover {
    background: var(--gray2);
    border-color: var(--gray5);
  }

  :where([data-sonner-toast][data-swiping='true'])::before {
    content: '';
    position: absolute;
    left: 0;
    right: 0;
    height: 100%;
    z-index: -1;
  }

  :where([data-sonner-toast][data-y-position='top'][data-swiping='true'])::before {
    bottom: 50%;
    transform: scaleY(3) translateY(50%);
  }

  :where([data-sonner-toast][data-y-position='bottom'][data-swiping='true'])::before {
    top: 50%;
    transform: scaleY(3) translateY(-50%);
  }

  :where([data-sonner-toast][data-swiping='false'][data-removed='true'])::before {
    content: '';
    position: absolute;
    inset: 0;
    transform: scaleY(2);
  }

  :where([data-sonner-toast])::after {
    content: '';
    position: absolute;
    left: 0;
    height: calc(var(--gap) + 1px);
    bottom: 100%;
    width: 100%;
  }

  :where([data-sonner-toast][data-mounted='true']) {
    --y: translateY(0);
    opacity: 1;
  }

  :where([data-sonner-toast][data-expanded='false'][data-front='false']) {
    --scale: var(--toasts-before) * 0.05 + 1;
    --y: translateY(calc(var(--lift-amount) * var(--toasts-before))) scale(calc(-1 * var(--scale)));
    height: var(--front-toast-height);
  }

  :where([data-sonner-toast]) > * {
    transition: opacity 0.4s;
  }

  :where([data-sonner-toast][data-visible='false']) {
    opacity: 0;
    pointer-events: none;
  }

  :where([data-sonner-toast][data-mounted='true'][data-expanded='true']) {
    --y: translateY(calc(var(--lift) * var(--offset)));
    height: var(--initial-height);
  }

  :where([data-sonner-toast][data-removed='true'][data-front='true'][data-swipe-out='false']) {
    --y: translateY(calc(var(--lift) * -100%));
    opacity: 0;
  }

  :where(
    [data-sonner-toast][data-removed='true'][data-front='false'][data-swipe-out='false'][data-expanded='true']
  ) {
    --y: translateY(calc(var(--lift) * var(--offset) + var(--lift) * -100%));
    opacity: 0;
  }

  :where(
    [data-sonner-toast][data-removed='true'][data-front='false'][data-swipe-out='false'][data-expanded='false']
  ) {
    --y: translateY(40%);
    opacity: 0;
    transition:
      transform 0.5s,
      opacity 0.2s;
  }

  :where([data-sonner-toast][data-removed='true'][data-front='false'])::before {
    height: calc(var(--initial-height) + 20%);
  }

  [data-sonner-toast][data-swiping='true'] {
    transform: var(--y) translateY(var(--swipe-amount, 0));
    transition: none;
  }

  [data-sonner-toast][data-swiped='true'] {
    user-select: none;
  }

  [data-sonner-toast][data-swipe-out='true'][data-y-position='bottom'],
  [data-sonner-toast][data-swipe-out='true'][data-y-position='top'] {
    animation: ohne-toast-swipe-out 0.2s ease-out forwards;
  }

  @keyframes ohne-toast-swipe-out {
    from {
      transform: translateY(calc(var(--lift) * var(--offset) + var(--swipe-amount)));
      opacity: 1;
    }

    to {
      transform: translateY(
        calc(var(--lift) * var(--offset) + var(--swipe-amount) + var(--lift) * -100%)
      );
      opacity: 0;
    }
  }

  @media (max-width: 600px) {
    [data-sonner-toaster] {
      position: fixed;
      --mobile-offset: 16px;
      right: var(--mobile-offset);
      left: var(--mobile-offset);
      width: 100%;
    }

    [data-sonner-toaster] [data-sonner-toast] {
      left: 0;
      right: 0;
      width: calc(100% - var(--mobile-offset) * 2);
    }

    [data-sonner-toaster][data-x-position='left'] {
      left: var(--mobile-offset);
    }

    [data-sonner-toaster][data-y-position='bottom'] {
      bottom: 20px;
    }

    [data-sonner-toaster][data-y-position='top'] {
      top: 20px;
    }

    [data-sonner-toaster][data-x-position='center'] {
      left: var(--mobile-offset);
      right: var(--mobile-offset);
      transform: none;
    }
  }

  @media (prefers-reduced-motion) {
    [data-sonner-toast],
    [data-sonner-toast] > * {
      transition: none !important;
      animation: none !important;
    }
  }

  .ohne-toaster {
    top: calc(0.5rem - 0.5px);
    z-index: 99998;
  }

  .ohne-toast {
    --ohne-size: var(--ohne-toast-size);
    --ohne-background: var(--ohne-accent);
    --ohne-foreground: var(--ohne-accent-foreground);
    display: flex;
    gap: 0.5em;
    width: 100%;
    background-color: hsl(var(--ohne-accent));
    border-radius: var(--ohne-radius);
    padding: calc(0.75em - 0.0625rem);
    padding: round(calc(0.75em - 0.0625rem), 1px);
    color: hsl(var(--ohne-accent-foreground));
    font-size: calc(1rem + var(--ohne-toast-size) * 0.125rem);
  }

  .ohne-toast:focus-visible {
    box-shadow: none;
    border-color: hsl(var(--ohne-primary));
  }

  .ohne-toast-action:not(.ohne-toast-description) {
    align-items: center;
  }

  .ohne-toast-error,
  .ohne-toast[data-type='error'],
  .ohne-toast[data-type='warning'] {
    --ohne-background: var(--ohne-destructive);
    --ohne-foreground: var(--ohne-destructive-foreground);
    background-color: hsl(var(--ohne-destructive));
    color: hsl(var(--ohne-destructive-foreground));
  }

  .ohne-toast pre {
    background-color: hsl(var(--ohne-primary));
    color: hsl(var(--ohne-primary-foreground));
  }

  .ohne-toast :not(pre) > code {
    background-color: hsl(var(--ohne-primary-foreground));
    color: hsl(var(--ohne-primary));
  }

  .ohne-toast-error :not(pre) > code,
  .ohne-toast[data-type='error'] :not(pre) > code,
  .ohne-toast[data-type='warning'] :not(pre) > code {
    background-color: rgba(0, 0, 0, 0.2);
    color: hsl(var(--ohne-destructive-foreground));
  }

  .dark .ohne-toast pre,
  .dark .ohne-toast :not(pre) > code {
    background-color: rgba(0, 0, 0, 0.2);
    color: var(--ohne-foreground);
  }

  .ohne-toast blockquote {
    border-left-color: hsl(var(--ohne-primary-foreground));
    line-height: 1.625em;
  }

  .ohne-toast blockquote + blockquote {
    margin-top: 0.5em;
  }

  .ohne-toast-error blockquote,
  .ohne-toast[data-type='error'] blockquote,
  .ohne-toast[data-type='warning'] blockquote {
    border-left-color: rgba(0, 0, 0, 0.2);
  }

  .dark .ohne-toast blockquote {
    border-left-color: rgba(0, 0, 0, 0.2);
  }

  .ohne-toast [data-icon] {
    flex-shrink: 0;
    display: block;
    width: auto;
    height: auto;
    margin: 0;
  }

  .ohne-toast [data-icon] svg {
    margin: 0;
  }

  .ohne-toast [data-content] {
    flex: 1;
  }

  .ohne-toast [data-title] {
    font-weight: 600;
  }

  .ohne-toast [data-title]:not(:last-child) {
    margin-bottom: 0.125em;
  }

  .ohne-toast [data-description] {
    flex: 1;
    font-size: calc(1em - 0.0625rem);
  }

  .ohne-toast [data-button] {
    margin-top: auto;
    padding: 0 0.75em;
    padding: 0 round(0.75em, 1px);
    font-size: calc(1em - 0.0625rem);
  }

  .ohne-toast [data-close-button] {
    width: 1.5em;
    height: 1.5em;
    background-color: hsl(var(--ohne-primary)) !important;
    border: none;
    color: hsl(var(--ohne-primary-foreground)) !important;
    transition: var(--ohne-transition);
    transition-property: background-color, box-shadow, color;
  }

  .ohne-toast [data-close-button] svg {
    width: 1em;
    height: 1em;
  }

  .ohne-toast [data-close-button]:focus-visible {
    box-shadow:
      0 0 0 0.125rem hsl(var(--ohne-background)),
      0 0 0 0.25rem hsl(var(--ohne-ring)),
      0 0 #0000;
    outline: 0.125rem solid transparent;
    outline-offset: 0.125rem;
  }

  @media (max-width: 1024px) {
    .ohne-toaster {
      top: calc(0.375rem - 0.5px) !important;
    }
  }

  @media (max-width: 600px) {
    .ohne-toaster {
      --mobile-offset: 0.3125rem;
    }
  }
`;

/**
 * Returns the type's leading icon at 1.5em, or `null` for `'default'`.
 */
function typeIcon(type: ToastRecord['type']): SVGSVGElement | null {
  if (type === 'default') return null;
  const svg = icon(TYPE_ICONS[type]);
  svg.setAttribute('width', '1.5em');
  svg.setAttribute('height', '1.5em');
  return svg;
}

/**
 * Builds the close button's 12px stroked cross from `CLOSE_SHAPE`.
 */
function closeIcon(): SVGSVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('width', '12');
  svg.setAttribute('height', '12');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.innerHTML = CLOSE_SHAPE;
  return svg;
}

/**
 * Shows a toast notification; `toaster` renders it.
 * The message and a `description` speak markdown-lite, exactly like dialog content.
 * Returns the toast id; calling again with the same `id` updates the showing toast in place.
 *
 * @example
 * ```ts
 * toast('Saved', { type: 'success' })
 * toast('Could not save `title`', { type: 'error' })
 * ```
 */
export function toast(message: string, options: ToastOptions = {}): string | number {
  const id = options.id ?? ++counter;
  const record: ToastRecord = {
    id,
    message,
    type: options.type ?? 'default',
    markdown: options.markdown ?? true,
    description: options.description,
    action: options.action,
    duration: options.duration ?? DEFAULT_DURATION,
    closeButton: options.closeButton ?? false,
    class: [
      options.action ? 'ohne-toast-action' : '',
      options.description ? 'ohne-toast-description' : '',
    ]
      .filter(Boolean)
      .join(' '),
    onDismiss: options.onDismiss,
    onAutoClose: options.onAutoClose,
  };
  const at = toasts.value.findIndex((entry) => entry.id === id);
  toasts.value =
    at === -1
      ? [record, ...toasts.value]
      : toasts.value.map((entry, index) => (index === at ? record : entry));
  return id;
}

/**
 * Dismisses the toast `id` as its close button does, without calling its `onDismiss`.
 * An id no toast carries is ignored.
 *
 * @example
 * ```ts
 * const id = toast('Upload failed', { type: 'error' })
 * dismissToast(id)
 * ```
 */
export function dismissToast(id: string | number): void {
  const dismiss = dismissers.get(id);
  if (!isUndefined(dismiss)) dismiss();
  else if (toasts.value.some((entry) => entry.id === id)) {
    toasts.value = toasts.value.filter((entry) => entry.id !== id);
  }
}

/**
 * Queues a toast notification for the `toaster` to drain.
 * Use it when the toaster is not mounted yet, or when a toast must survive an imminent navigation.
 * The queue flushes on mount and on every route change; `showAfterRouteChange` holds until the latter.
 *
 * @example
 * ```ts
 * queueToast('Logged out', { type: 'success', showAfterRouteChange: true })
 * navigate('/login')
 * ```
 */
export function queueToast(message: string, options?: ToastOptions): void {
  queue.value = [...queue.value, { message, options }];
}

/**
 * The global toast outlet: a top-center stack of at most 3 visible toasts.
 * Timers pause while the stack is hovered or held, a swipe up dismisses, and Alt+T focuses the stack.
 * Mount it once in the shell; `toast` and `queueToast` feed it from anywhere.
 *
 * Every call returns the same element, so a screen swap re-parents it instead of rebuilding it.
 * A showing toast keeps its DOM, its running timer, and its animation state across navigations.
 *
 * @example
 * ```ts
 * h('div', null, page, toaster())
 * ```
 */
export function toaster(): HTMLElement {
  outlet ??= effectScope(true).run(createToaster);
  return outlet;
}

/**
 * Builds the outlet `toaster` caches, wiring hover pause, focus restore, Alt+T, and the queue drains.
 */
function createToaster(): HTMLElement {
  const expanded = ref(false);
  const interacting = ref(false);
  let isFocusWithin = false;
  let lastFocused: HTMLElement | null = null;

  const toastItem = (item: () => ToastRecord, index: () => number): Child => {
    const record = untracked(item);
    const id = record.id;
    const mounted = ref(false);
    const removed = ref(false);
    const swiping = ref(false);
    const swipeOut = ref(false);
    const swipeAmount = ref('0px');
    let offsetBeforeRemove = 0;
    let pointerStartedAt = 0;
    let pointerStart: { x: number; y: number } | null = null;

    const offset = (): number => {
      const list = heights.value;
      const at = list.findIndex((entry) => entry.toastId === id) || 0;
      const before = list.reduce((total, entry, i) => (i >= at ? total : total + entry.height), 0);
      return at * GAP + before || 0;
    };

    let removal: ReturnType<typeof setTimeout> | undefined;

    const deleteToast = (): void => {
      if (untracked(() => removed.value)) return;
      removed.value = true;
      offsetBeforeRemove = untracked(offset);
      heights.value = heights.value.filter((entry) => entry.toastId !== id);
      removal = setTimeout(() => {
        toasts.value = toasts.value.filter((entry) => entry.id !== id);
      }, REMOVE_DELAY);
    };
    dismissers.set(id, deleteToast);
    onCleanup(() => dismissers.delete(id));

    let timed = record;
    let remaining = record.duration;
    let startedAt = 0;
    let pausedAt = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;

    effect(() => {
      clearTimeout(timer);
      if (item() !== timed) {
        timed = item();
        remaining = timed.duration;
        startedAt = 0;
        pausedAt = 0;
      }
      if (removed.value || remaining === Infinity) return;
      const paused = expanded.value || interacting.value;
      if (paused) {
        if (pausedAt < startedAt) remaining -= Date.now() - startedAt;
        pausedAt = Date.now();
      } else {
        startedAt = Date.now();
        timer = setTimeout(() => {
          untracked(item).onAutoClose?.();
          deleteToast();
        }, remaining);
      }
    });
    onCleanup(() => clearTimeout(timer));

    effect(() => {
      void item();
      untracked(() => {
        if (!removed.value) return;
        clearTimeout(removal);
        swiping.value = false;
        swipeOut.value = false;
        swipeAmount.value = '0px';
        // Back at the front, where its height re-enters the stack.
        toasts.value = [item(), ...toasts.value.filter((entry) => entry.id !== id)];
        removed.value = false;
      });
    });

    const li = h(
      'li',
      {
        tabindex: '0',
        role: 'status',
        'aria-live': 'polite',
        'aria-atomic': 'true',
        'data-sonner-toast': 'true',
        class: () => {
          const classes = item().class;
          return classes ? `ohne-toast ${classes}` : 'ohne-toast';
        },
        'data-styled': 'false',
        'data-mounted': () => String(mounted.value),
        'data-promise': 'false',
        'data-removed': () => String(removed.value),
        'data-visible': () => String(index() + 1 <= VISIBLE_TOASTS),
        'data-y-position': 'top',
        'data-x-position': 'center',
        'data-index': () => index(),
        'data-front': () => String(index() === 0),
        'data-swiping': () => String(swiping.value),
        'data-dismissible': 'true',
        'data-type': () => {
          const type = item().type;
          return type === 'default' ? null : type;
        },
        'data-invert': 'false',
        'data-swipe-out': () => String(swipeOut.value),
        'data-expanded': () => String(expanded.value || mounted.value),
        style: () =>
          `--index: ${index()}; --toasts-before: ${index()}; ` +
          `--z-index: ${toasts.value.length - index()}; ` +
          `--offset: ${removed.value ? offsetBeforeRemove : offset()}px; ` +
          `--initial-height: auto; --swipe-amount: ${swipeAmount.value};`,
        onPointerdown: (event: PointerEvent) => {
          pointerStartedAt = Date.now();
          offsetBeforeRemove = untracked(offset);
          if (!(event.target instanceof HTMLElement)) return;
          event.target.setPointerCapture(event.pointerId);
          if (event.target.tagName !== 'BUTTON') {
            swiping.value = true;
            pointerStart = { x: event.clientX, y: event.clientY };
          }
        },
        onPointermove: (event: PointerEvent) => {
          if (!pointerStart) return;
          const delta = event.clientY - pointerStart.y;
          const highlighted = (window.getSelection()?.toString().length ?? 0) > 0;
          if (!highlighted) swipeAmount.value = `${Math.min(0, delta)}px`;
        },
        onPointerup: () => {
          if (untracked(() => swipeOut.value)) return;
          pointerStart = null;
          const amount = Number.parseFloat(untracked(() => swipeAmount.value));
          const elapsed = Date.now() - pointerStartedAt;
          const velocity = Math.abs(amount) / elapsed;
          if (Math.abs(amount) >= SWIPE_THRESHOLD || velocity > 0.11) {
            offsetBeforeRemove = untracked(offset);
            untracked(item).onDismiss?.();
            deleteToast();
            swipeOut.value = true;
            return;
          }
          swipeAmount.value = '0px';
          swiping.value = false;
        },
      },
      () =>
        item().closeButton
          ? h(
              'button',
              {
                'aria-label': 'Close toast',
                'data-disabled': 'false',
                'data-close-button': 'true',
                onClick: () => {
                  deleteToast();
                  untracked(item).onDismiss?.();
                },
              },
              closeIcon(),
            )
          : null,
      () => {
        const svg = typeIcon(item().type);
        return svg ? h('div', { 'data-icon': '' }, svg) : null;
      },
      h(
        'div',
        { 'data-content': '' },
        h('div', { 'data-title': '' }, () => {
          const current = item();
          const prose = h('div', { class: 'ohne-prose' });
          renderProse(prose, current.message, { markdown: current.markdown });
          return prose;
        }),
        () => {
          const current = item();
          if (isUndefined(current.description)) return null;
          const prose = h('div', { class: 'ohne-prose' });
          renderProse(prose, current.description, { markdown: current.markdown });
          return h('div', { 'data-description': '' }, prose);
        },
      ),
      () => {
        const action = item().action;
        return action
          ? h(
              'button',
              {
                class: 'ohne-button ohne-button-primary ohne-raw',
                'data-button': '',
                'data-action': '',
                onClick: (event: MouseEvent) => {
                  if (event.defaultPrevented) return;
                  action.onClick(event);
                  if (!event.defaultPrevented) deleteToast();
                },
              },
              action.label,
            )
          : null;
      },
    );

    setTimeout(() => {
      mounted.value = true;
    });

    effect(() => {
      void item();
      if (!mounted.value || removed.value) return;
      untracked(() => {
        const inline = li.style.height;
        li.style.height = 'auto';
        const height = li.getBoundingClientRect().height;
        li.style.height = inline;
        heights.value = heights.value.some((entry) => entry.toastId === id)
          ? heights.value.map((entry) => (entry.toastId === id ? { ...entry, height } : entry))
          : [{ toastId: id, height }, ...heights.value];
      });
    });

    onCleanup(() => {
      heights.value = heights.value.filter((entry) => entry.toastId !== id);
    });

    return li;
  };

  const list = h(
    'ol',
    {
      tabindex: '-1',
      class: 'ohne-toaster',
      dir: 'ltr',
      'data-sonner-toaster': 'true',
      'data-y-position': 'top',
      'data-x-position': 'center',
      'data-lifted': 'false',
      style: () =>
        `--front-toast-height: ${first(heights.value)?.height}px; ` +
        `--offset: 0.5rem; --width: 336px; --gap: ${GAP}px;`,
      onMouseenter: () => (expanded.value = true),
      onMousemove: () => (expanded.value = true),
      onMouseleave: () => {
        if (!untracked(() => interacting.value)) expanded.value = false;
      },
      onPointerdown: (event: PointerEvent) => {
        const dismissible =
          !(event.target instanceof HTMLElement) || event.target.dataset.dismissible !== 'false';
        if (dismissible) interacting.value = true;
      },
      onPointerup: () => (interacting.value = false),
      onFocusin: (event: FocusEvent) => {
        if (event.target instanceof HTMLElement && event.target.dataset.dismissible === 'false') {
          return;
        }
        if (!isFocusWithin) {
          isFocusWithin = true;
          lastFocused = event.relatedTarget instanceof HTMLElement ? event.relatedTarget : null;
        }
      },
      onFocusout: (event: FocusEvent) => {
        const leaving = !(
          event.relatedTarget instanceof Node && list.contains(event.relatedTarget)
        );
        if (isFocusWithin && leaving) {
          isFocusWithin = false;
          if (lastFocused) {
            lastFocused.focus({ preventScroll: true });
            lastFocused = null;
          }
        }
      },
    },
    each(
      () => toasts.value,
      (record) => record.id,
      toastItem,
    ),
  );

  effect(() => {
    if (toasts.value.length <= 1) expanded.value = false;
  });

  // Re-raised per change, so a toast arriving over an open panel lands on top of it.
  effect(() => {
    if (!isEmpty(toasts.value) && list.isConnected) raiseToTopLayer(list);
  });

  const onDocumentKeydown = (event: KeyboardEvent): void => {
    if (event.altKey && event.code === 'KeyT') {
      expanded.value = true;
      list.focus();
    }
    if (
      event.code === 'Escape' &&
      (document.activeElement === list || list.contains(document.activeElement))
    ) {
      expanded.value = false;
    }
  };
  document.addEventListener('keydown', onDocumentKeydown);
  onCleanup(() => document.removeEventListener('keydown', onDocumentKeydown));

  effect(() => {
    const pending = queue.value;
    if (isEmpty(pending)) return;
    untracked(() => {
      let displayed = 0;
      for (const { message, options } of pending) {
        if (!options?.showAfterRouteChange) {
          setTimeout(() => toast(message, options));
          displayed++;
        }
      }
      if (displayed) queue.value = pending.filter(({ options }) => options?.showAfterRouteChange);
    });
  });

  let lastPath: string | undefined;
  let firstRoute = true;
  effect(() => {
    const path = useRoute()?.path;
    if (!firstRoute && path === lastPath) return;
    firstRoute = false;
    lastPath = path;
    untracked(() => {
      const pending = queue.value;
      if (isEmpty(pending)) return;
      for (const { message, options } of pending) setTimeout(() => toast(message, options));
      queue.value = [];
    });
  });

  return h(
    'section',
    {
      tabindex: '-1',
      'aria-label': 'Notifications alt+T',
      'aria-live': 'polite',
      'aria-relevant': 'additions text',
      'aria-atomic': 'false',
    },
    list,
  );
}
