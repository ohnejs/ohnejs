import type { KeyStroke } from './key-stroke.ts';
import type { Platform } from './platform.ts';

/**
 * Reads a key spec such as `'shift+mod+z'` into the stroke it names on `platform`.
 * `mod` becomes Command on macOS and Control elsewhere, and the key comes back through `normalizeKey`.
 * A bare trailing `+` is the plus key itself.
 * Throws if a spec contains an unrecognized modifier.
 */
export function parseKeySpec(spec: string, platform: Platform): KeyStroke {
  const parts = spec.split('+').map((part) => part.trim());
  let key = parts.pop() ?? '';
  if (key === '') {
    key = '+';
    parts.pop();
  }

  const stroke: KeyStroke = {
    key: normalizeKey(key),
    ctrl: false,
    alt: false,
    shift: false,
    meta: false,
  };
  for (const part of parts) {
    const mod = part.toLowerCase();
    if (mod === 'shift') stroke.shift = true;
    else if (mod === 'alt' || mod === 'option' || mod === 'opt') stroke.alt = true;
    else if (mod === 'ctrl' || mod === 'control') stroke.ctrl = true;
    else if (mod === 'meta' || mod === 'cmd' || mod === 'command' || mod === 'win')
      stroke.meta = true;
    else if (mod === 'mod' && platform === 'mac') stroke.meta = true;
    else if (mod === 'mod') stroke.ctrl = true;
    else throw new Error(`Unknown key modifier "${part}" in "${spec}"`);
  }

  return stroke;
}

/**
 * Lowercases a key and maps the aliases `space` and `esc` to the values a stroke carries.
 */
export function normalizeKey(key: string): string {
  const lower = key.toLowerCase();
  if (lower === 'space') return ' ';
  if (lower === 'esc') return 'escape';
  return lower;
}
