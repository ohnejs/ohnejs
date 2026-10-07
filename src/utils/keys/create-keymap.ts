import type { KeyStroke } from './key-stroke.ts';
import type { Platform } from './platform.ts';

import { isFunction } from '../is/is-function.ts';
import { normalizeKey, parseKeySpec } from './_parse-key-spec.ts';
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
    compiled.set(canonical(parseKeySpec(spec, platform)), run);
  }

  return (stroke) => {
    const run = compiled.get(canonical(stroke));
    return run ? run() !== false : false;
  };
}

/**
 * Builds the lookup key shared by specs and strokes: modifier flags in fixed order, then the normalized key.
 */
function canonical({ ctrl, alt, shift, meta, key }: KeyStroke): string {
  const flags = `${ctrl ? 'C' : ''}${alt ? 'A' : ''}${shift ? 'S' : ''}${meta ? 'M' : ''}`;
  return `${flags} ${normalizeKey(key)}`;
}
