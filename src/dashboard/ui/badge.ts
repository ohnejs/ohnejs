import type { Child } from '../render/insert.ts';

import { ref } from '../../utils/reactive/ref.ts';
import { css } from '../render/css.ts';
import { h } from '../render/h.ts';
import './tokens.ts';

/**
 * Options for `badge`.
 */
export interface BadgeOptions {
  /**
   * The background color of the badge.
   * Accepts a predefined UI color name or any valid CSS color value.
   *
   * @default
   * 'primary'
   */
  color?: 'primary' | 'secondary' | 'accent' | 'destructive' | (string & {});

  /**
   * The text color of the badge.
   * If not provided, the text color is automatically determined from the background color.
   */
  textColor?: string;

  /**
   * Size step of the component: -2 very small, -1 small, 0 default, 1 large, 2 very large.
   * Omitted inherits `--ohne-size` from the nearest ancestor.
   */
  size?: number;
}

const TOKENS = ['primary', 'secondary', 'accent', 'destructive'];

css`
  .ohne-badge {
    flex-shrink: 0;
    display: inline-flex;
    max-width: 100%;
    padding: 0.140625rem 0.5rem;
    overflow: hidden;
    border-radius: calc(var(--ohne-radius) - 0.125rem);
    font-size: calc(1rem + var(--ohne-size) * 0.125rem - 0.0625rem);
    font-weight: 500;
    text-overflow: ellipsis;
    white-space: nowrap;
    user-select: none;
  }
`;

/**
 * An inline pill label with an arbitrary background color and automatic contrast text color.
 * A token color name pairs with its foreground token.
 * Any other CSS color is measured after attachment.
 * The text turns white when the WCAG relative luminance lands below `0.5`.
 *
 * @example
 * ```ts
 * badge('Draft')
 * badge('Live', { color: '#16a34a' })
 * ```
 */
export function badge(content: Child | (() => Child), options: BadgeOptions = {}): HTMLElement {
  const color = options.color ?? 'primary';
  const backgroundColor = TOKENS.includes(color) ? `hsl(var(--ohne-${color}))` : color;
  const textColor =
    options.textColor ?? (TOKENS.includes(color) ? `hsl(var(--ohne-${color}-foreground))` : null);
  const isDark = ref(false);
  const root = h(
    'span',
    {
      class: 'ohne-badge',
      style: () =>
        (options.size === undefined ? '' : `--ohne-size: ${options.size}; `) +
        `background-color: ${backgroundColor}; ` +
        `color: ${textColor ?? (isDark.value ? 'white' : 'black')}`,
    },
    content,
  );
  // Deferred a microtask so the badge is attached and `getComputedStyle` resolves the token vars.
  if (textColor === null) {
    queueMicrotask(() => {
      const resolved = getComputedStyle(root).getPropertyValue('background-color');
      const channels = resolved.match(/\d+/g);
      if (channels) {
        const [r, g, b] = channels.map(Number);
        if (r !== undefined && g !== undefined && b !== undefined) {
          isDark.value = luminance(r, g, b) < 0.5;
        }
      }
    });
  }
  return root;
}

/**
 * The WCAG relative luminance of 0-255 sRGB channels, from `0` for black to `1` for white.
 */
function luminance(r: number, g: number, b: number): number {
  const rr = r / 255;
  const gg = g / 255;
  const bb = b / 255;
  const rsRGB = rr <= 0.03928 ? rr / 12.92 : Math.pow((rr + 0.055) / 1.055, 2.4);
  const gsRGB = gg <= 0.03928 ? gg / 12.92 : Math.pow((gg + 0.055) / 1.055, 2.4);
  const bsRGB = bb <= 0.03928 ? bb / 12.92 : Math.pow((bb + 0.055) / 1.055, 2.4);
  return 0.2126 * rsRGB + 0.7152 * gsRGB + 0.0722 * bsRGB;
}
