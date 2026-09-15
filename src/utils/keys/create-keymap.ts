import type { KeyStroke } from './key-stroke.ts';
import type { Platform } from './platform.ts';

import { isFunction } from '../is/is-function.ts';
import { detectPlatform } from './platform.ts';

/**
 * Runs when its bound stroke matches.
 * Return `false` to signal the stroke was not handled, so a later keymap may claim it.
 * Returning anything else (including nothing) counts as handled.
 */
export type KeyCommand = () => boolean | void;

/**
 * A command with an optional platform filter.
 * Use the object form when a binding should only apply on some platforms.
 */
export interface Binding {
  /**
   * The command to run on a match.
   */
  run: KeyCommand;

  /**
   * The platforms this binding applies on.
   * When set, the binding is dropped on every other platform.
   */
  platforms?: Platform[];
}

/**
 * A set of key specs mapped to commands.
 * Each spec is plus-separated modifiers then a key, written lowercase, e.g. `'shift+mod+z'`.
 * Modifiers are `shift`, `alt` (`option`), `ctrl` (`control`), `meta` (`cmd`, `win`), and `mod`.
 * `mod` is Command on macOS and Control elsewhere.
 * Matching is case-insensitive.
 */
export type Keymap = Record<string, KeyCommand | Binding>;

/**
 * Options for `createKeymap`.
 */
export interface KeymapOptions {
  /**
   * The platform to compile bindings for.
   *
   * @default
   * detectPlatform()
   */
  platform?: Platform;
}

/**
 * Tests a stroke against a compiled keymap, returning whether it was handled.
 */
export type KeyMatcher = (stroke: KeyStroke) => boolean;

/**
 * Compiles a keymap into a matcher for the given platform.
 * `mod` collapses to Command or Control, and out-of-platform bindings are dropped.
 * Throws if a spec contains an unrecognized modifier.
 *
 * @example
 * ```ts
 * const match = createKeymap({
 *   enter: onSubmit,
 *   'ctrl+s': onSave,
 * })
 *
 * match({ key: 'Enter', ctrl: false, alt: false, shift: false, meta: false })
 * // -> true
 * ```
 */
export function createKeymap(keymap: Keymap, options: KeymapOptions = {}): KeyMatcher {
  const platform = options.platform ?? detectPlatform();
  const compiled = new Map<string, KeyCommand>();

  for (const [spec, binding] of Object.entries(keymap)) {
    const run = isFunction<KeyCommand>(binding) ? binding : binding.run;
    const platforms = isFunction<KeyCommand>(binding) ? undefined : binding.platforms;
    if (platforms && !platforms.includes(platform)) continue;
    compiled.set(compileSpec(spec, platform), run);
  }

  return (stroke) => {
    const run = compiled.get(
      canonical(stroke.ctrl, stroke.alt, stroke.shift, stroke.meta, stroke.key),
    );
    return run ? run() !== false : false;
  };
}

/**
 * Resolves a spec to its lookup key for `platform`; a bare trailing `+` is the plus key itself.
 */
function compileSpec(spec: string, platform: Platform): string {
  const parts = spec.split('+').map((part) => part.trim());
  let key = parts.pop() ?? '';
  if (key === '') {
    key = '+';
    parts.pop();
  }

  let ctrl = false;
  let alt = false;
  let shift = false;
  let meta = false;
  for (const part of parts) {
    const mod = part.toLowerCase();
    if (mod === 'shift') shift = true;
    else if (mod === 'alt' || mod === 'option' || mod === 'opt') alt = true;
    else if (mod === 'ctrl' || mod === 'control') ctrl = true;
    else if (mod === 'meta' || mod === 'cmd' || mod === 'command' || mod === 'win') meta = true;
    else if (mod === 'mod' && platform === 'mac') meta = true;
    else if (mod === 'mod') ctrl = true;
    else throw new Error(`Unknown key modifier "${part}" in "${spec}"`);
  }

  return canonical(ctrl, alt, shift, meta, key);
}

/**
 * Builds the lookup key shared by specs and strokes: modifier flags in fixed order, then the normalized key.
 */
function canonical(
  ctrl: boolean,
  alt: boolean,
  shift: boolean,
  meta: boolean,
  key: string,
): string {
  const flags = `${ctrl ? 'C' : ''}${alt ? 'A' : ''}${shift ? 'S' : ''}${meta ? 'M' : ''}`;
  return `${flags} ${normalizeKey(key)}`;
}

/**
 * Lowercases a key and maps the aliases `space` and `esc` to the values a stroke carries.
 */
function normalizeKey(key: string): string {
  const lower = key.toLowerCase();
  if (lower === 'space') return ' ';
  if (lower === 'esc') return 'escape';
  return lower;
}
