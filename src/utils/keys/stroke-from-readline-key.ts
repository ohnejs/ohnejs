import type { KeyStroke } from './key-stroke.ts';

/**
 * The decoded keypress `node:readline` produces alongside the raw string.
 */
export interface ReadlineKey {
  name?: string;
  ctrl?: boolean;
  meta?: boolean;
  shift?: boolean;
  sequence?: string;
}

const NAMED: Record<string, string> = {
  return: 'Enter',
  enter: 'Enter',
  backspace: 'Backspace',
  delete: 'Delete',
  tab: 'Tab',
  escape: 'Escape',
  space: ' ',
  up: 'ArrowUp',
  down: 'ArrowDown',
  left: 'ArrowLeft',
  right: 'ArrowRight',
  home: 'Home',
  end: 'End',
  pageup: 'PageUp',
  pagedown: 'PageDown',
  insert: 'Insert',
};

/**
 * Normalizes a `node:readline` keypress into a `KeyStroke`.
 * Readline's `meta` is Alt (Option), and a terminal can never send Command, so `meta` is always `false`.
 * Named keys are translated to their `KeyboardEvent.key` spelling.
 * That lets one keymap match both the terminal and the browser.
 *
 * @example
 * ```ts
 * readline.emitKeypressEvents(input)
 * input.on('keypress', (str, key) => match(strokeFromReadlineKey(str, key)))
 * ```
 */
export function strokeFromReadlineKey(str: string | undefined, key: ReadlineKey): KeyStroke {
  return {
    key: keyValue(str, key.name),
    ctrl: Boolean(key.ctrl),
    alt: Boolean(key.meta),
    shift: Boolean(key.shift),
    meta: false,
  };
}

function keyValue(str: string | undefined, name: string | undefined): string {
  const named = name ? NAMED[name] : undefined;
  if (named) return named;
  if (str && isGraphic(str)) return str;
  return name ?? '';
}

function isGraphic(str: string): boolean {
  for (const char of str) {
    const code = char.codePointAt(0)!;
    if (code < 0x20 || code === 0x7f) return false;
  }
  return true;
}
