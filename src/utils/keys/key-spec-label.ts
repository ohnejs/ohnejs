import type { Platform } from './platform.ts';

import { capitalize } from '../case/capitalize.ts';
import { parseKeySpec } from './_parse-key-spec.ts';
import { detectPlatform } from './platform.ts';

const KEYS: Record<string, string> = {
  ' ': 'Space',
  arrowdown: '↓',
  arrowleft: '←',
  arrowright: '→',
  arrowup: '↑',
  delete: 'Del',
  escape: 'Esc',
  pagedown: 'PgDn',
  pageup: 'PgUp',
};

/**
 * Renders a key spec as the label a tooltip or a `<kbd>` shows, e.g. `'mod+shift+z'` as `'Cmd + Shift + Z'`.
 * The spec is written as for `createKeymap`, and `mod` reads as Command on macOS and Control elsewhere.
 * Modifiers come in a fixed order: Control, then Command or Win, then Alt or Option, then Shift.
 * A letter is uppercased, an arrow is its glyph, and `escape` and `delete` shorten to `Esc` and `Del`.
 *
 * @example
 * ```ts
 * keySpecLabel('mod+s', 'mac')       // -> 'Cmd + S'
 * keySpecLabel('mod+s', 'win')       // -> 'Ctrl + S'
 * keySpecLabel('mod+shift+z', 'mac') // -> 'Cmd + Shift + Z'
 * keySpecLabel('mod+alt+2', 'mac')   // -> 'Cmd + Option + 2'
 * keySpecLabel('mod+arrowup', 'win') // -> 'Ctrl + ↑'
 * keySpecLabel('esc', 'linux')       // -> 'Esc'
 * ```
 */
export function keySpecLabel(spec: string, platform: Platform = detectPlatform()): string {
  const stroke = parseKeySpec(spec, platform);
  const mac = platform === 'mac';
  const parts: string[] = [];

  if (stroke.ctrl) parts.push('Ctrl');
  if (stroke.meta) parts.push(mac ? 'Cmd' : 'Win');
  if (stroke.alt) parts.push(mac ? 'Option' : 'Alt');
  if (stroke.shift) parts.push('Shift');
  parts.push(KEYS[stroke.key] ?? capitalize(stroke.key));

  return parts.join(' + ');
}
