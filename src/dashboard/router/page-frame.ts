import type { Child } from '../render/insert.ts';

import { onCleanup } from '../../utils/reactive/effect-scope.ts';
import { ref, type Ref } from '../../utils/reactive/ref.ts';
import { untracked } from '../../utils/reactive/untracked.ts';

/**
 * What a page asks of the frame around it.
 */
export interface FrameOptions {
  /**
   * Hands the page the main area edge to edge at full height; the page scrolls itself.
   *
   * @default
   * false
   */
  fill?: boolean;

  /**
   * Gives the page the full window width; the sidebar becomes an overlay at every width.
   *
   * @default
   * false
   */
  wide?: boolean;
}

/**
 * What the router hands the registered page frame.
 */
export interface PageFrameContext {
  /**
   * The active page, as a function child that swaps in place when the page changes.
   * Insert it once; never call it.
   */
  content: () => Child;

  /**
   * The options every live `useFrame` scope asks for, merged.
   * Reactive.
   */
  options: () => Readonly<Required<FrameOptions>>;
}

/**
 * The chrome around every framed page, like a header and a sidebar.
 * The router mounts it once and keeps it across navigations; only `content` swaps.
 * It decides when the page builds, so a frame that gates on sign-in builds no page signed out.
 */
export type PageFrame = (frame: PageFrameContext) => Child;

let registered: PageFrame | null = null;
const fill = ref(0);
const wide = ref(0);

/**
 * Registers the frame the router mounts around every page that does not opt out with `frame: false`.
 * The last call wins, so the closest layer's `dashboard/boot` file replaces a further one's frame.
 * Without a registered frame, every page renders bare.
 *
 * @example
 * ```ts
 * // dashboard/boot/shell.ts
 * import { h, registerPageFrame } from 'ohnejs/dashboard'
 *
 * registerPageFrame(({ content, options }) =>
 *   h('main', { class: () => (options().fill ? 'fill' : 'padded') }, content),
 * )
 * ```
 */
export function registerPageFrame(frame: PageFrame): void {
  registered = frame;
}

/**
 * Asks the frame for `options` while the calling scope lives.
 * Each option merges on its own: any live scope asking for it turns it on, so `false` means not asking.
 * Outside a frame it does nothing.
 *
 * @example
 * ```ts
 * export default defineDashboardPage(() => {
 *   useFrame({ fill: true })
 *   return editor()
 * })
 * ```
 */
export function useFrame(options: FrameOptions): void {
  if (options.fill === true) hold(fill);
  if (options.wide === true) hold(wide);
}

/**
 * Counts `count` up while the calling scope lives.
 */
function hold(count: Ref<number>): void {
  count.value = untracked(() => count.value) + 1;
  onCleanup(() => {
    count.value = untracked(() => count.value) - 1;
  });
}

/**
 * The registered page frame, or `null` when no layer registered one.
 */
export function registeredFrame(): PageFrame | null {
  return registered;
}

/**
 * The options every live `useFrame` scope asks for, merged.
 * Reactive.
 */
export function frameOptions(): Readonly<Required<FrameOptions>> {
  return { fill: fill.value > 0, wide: wide.value > 0 };
}
