import type { KeyCommand, Keymap } from './create-keymap.ts';

/**
 * Bindings for a forward delete: `delete` everywhere, plus `ctrl+d` on macOS.
 *
 * @example
 * ```ts
 * createKeymap({ ...deleteKeymap(del) })
 * ```
 */
export function deleteKeymap(run: KeyCommand): Keymap {
  return {
    delete: run,
    'ctrl+d': { run, platforms: ['mac'] },
  };
}

/**
 * Bindings for deleting a word, `alt` on macOS and `ctrl` on Windows and Linux.
 * `back` removes the word before the cursor (`backspace`), `forward` the word after (`delete`).
 *
 * @example
 * ```ts
 * createKeymap({ ...deleteWordKeymap(deleteWordBack, deleteWordForward) })
 * ```
 */
export function deleteWordKeymap(back: KeyCommand, forward: KeyCommand): Keymap {
  return { ...wordChord('backspace', back), ...wordChord('delete', forward) };
}

/**
 * Bindings for deleting the whole line.
 * `mod+shift+k` works everywhere (Command or Control); macOS adds `meta+backspace`.
 *
 * @example
 * ```ts
 * createKeymap({ ...deleteLineKeymap(deleteLine) })
 * ```
 */
export function deleteLineKeymap(run: KeyCommand): Keymap {
  return {
    'mod+shift+k': run,
    'meta+backspace': { run, platforms: ['mac'] },
  };
}

/**
 * Bindings for moving the cursor a word, `alt` on macOS and `ctrl` on Windows and Linux.
 * `left` jumps to the previous word (`arrowleft`), `right` to the next (`arrowright`).
 *
 * @example
 * ```ts
 * createKeymap({ ...moveWordKeymap(wordLeft, wordRight) })
 * ```
 */
export function moveWordKeymap(left: KeyCommand, right: KeyCommand): Keymap {
  return { ...wordChord('arrowleft', left), ...wordChord('arrowright', right) };
}

/**
 * Bindings for jumping to the line start: `home` everywhere, plus `meta+arrowleft` on macOS.
 *
 * @example
 * ```ts
 * createKeymap({ ...lineStartKeymap(lineStart) })
 * ```
 */
export function lineStartKeymap(run: KeyCommand): Keymap {
  return {
    home: run,
    'meta+arrowleft': { run, platforms: ['mac'] },
  };
}

/**
 * Bindings for jumping to the line end: `end` everywhere, plus `meta+arrowright` on macOS.
 *
 * @example
 * ```ts
 * createKeymap({ ...lineEndKeymap(lineEnd) })
 * ```
 */
export function lineEndKeymap(run: KeyCommand): Keymap {
  return {
    end: run,
    'meta+arrowright': { run, platforms: ['mac'] },
  };
}

/**
 * Binding for undo: `mod+z` (Command on macOS, Control elsewhere).
 *
 * @example
 * ```ts
 * createKeymap({ ...undoKeymap(undo) })
 * ```
 */
export function undoKeymap(run: KeyCommand): Keymap {
  return {
    'mod+z': run,
  };
}

/**
 * Bindings for redo: `mod+y` and `shift+mod+z` on every platform.
 * macOS gets `cmd+y` and `cmd+shift+z`; Windows and Linux get `ctrl+y` and `ctrl+shift+z`.
 *
 * @example
 * ```ts
 * createKeymap({ ...redoKeymap(redo) })
 * ```
 */
export function redoKeymap(run: KeyCommand): Keymap {
  return {
    'mod+y': run,
    'shift+mod+z': run,
  };
}

/**
 * Binds `key` with `alt` on macOS and `ctrl` on Windows and Linux, the word-motion modifiers there.
 */
function wordChord(key: string, run: KeyCommand): Keymap {
  return {
    [`alt+${key}`]: { run, platforms: ['mac'] },
    [`ctrl+${key}`]: { run, platforms: ['win', 'linux'] },
  };
}
