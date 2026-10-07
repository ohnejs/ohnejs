import type { Platform } from './platform.ts';

import { capitalize } from '../case/capitalize.ts';
import { parseKeySpec } from './_parse-key-spec.ts';
import { detectPlatform } from './platform.ts';

const KEYS: Record<string, string> = {
  ' ': 'Space',
  '+': 'Plus',
  arrowdown: 'ArrowDown',
  arrowleft: 'ArrowLeft',
  arrowright: 'ArrowRight',
  arrowup: 'ArrowUp',
  pagedown: 'PageDown',
  pageup: 'PageUp',
};

/**
 * Renders a key spec as an `aria-keyshortcuts` value, e.g. `'mod+shift+z'` as `'Meta+Shift+Z'` on macOS.
 * The spec is written as for `createKeymap`, and `mod` reads as Command on macOS and Control elsewhere.
 * Keys take their `KeyboardEvent.key` names, and the space and plus keys read `Space` and `Plus`.
 *
 * @example
 * ```ts
 * ariaKeyShortcut('mod+b', 'mac')         // -> 'Meta+B'
 * ariaKeyShortcut('mod+b', 'win')         // -> 'Control+B'
 * ariaKeyShortcut('mod+alt+2', 'mac')     // -> 'Meta+Alt+2'
 * ariaKeyShortcut('alt+f10', 'linux')     // -> 'Alt+F10'
 * ariaKeyShortcut('shift+arrowup', 'mac') // -> 'Shift+ArrowUp'
 * ```
 */
export function ariaKeyShortcut(spec: string, platform: Platform = detectPlatform()): string {
  const stroke = parseKeySpec(spec, platform);
  const parts: string[] = [];

  if (stroke.ctrl) parts.push('Control');
  if (stroke.meta) parts.push('Meta');
  if (stroke.alt) parts.push('Alt');
  if (stroke.shift) parts.push('Shift');
  parts.push(KEYS[stroke.key] ?? capitalize(stroke.key));

  return parts.join('+');
}
