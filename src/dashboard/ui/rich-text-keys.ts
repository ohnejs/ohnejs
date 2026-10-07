import type { Keymap, KeymapOptions } from '../../utils/keys/create-keymap.ts';
import type { ComposingEventLike } from '../../utils/keys/is-composing.ts';
import type { KeyStroke } from '../../utils/keys/key-stroke.ts';
import type { Platform } from '../../utils/keys/platform.ts';
import type { KeyboardEventLike } from '../../utils/keys/stroke-from-keyboard-event.ts';
import type { RichTextMark, RichTextOptions } from '../../utils/rich-text/rich-text.ts';
import type { RichTextBlockType } from './rich-text-commands.ts';

import { createKeymap } from '../../utils/keys/create-keymap.ts';
import { isComposing } from '../../utils/keys/is-composing.ts';
import { detectPlatform } from '../../utils/keys/platform.ts';
import { strokeFromKeyboardEvent } from '../../utils/keys/stroke-from-keyboard-event.ts';
import {
  RICH_TEXT_DEFAULT_ELEMENTS,
  RICH_TEXT_DEFAULT_MARKS,
  RICH_TEXT_MARKS,
} from '../../utils/rich-text/rich-text.ts';

/**
 * The editor's shortcuts, as `createKeymap` specs keyed by what they do.
 * Marks and block types are keyed by their element, and `p` is the paragraph.
 * The toolbar reads a button's shortcut from here, so the two never drift apart.
 */
export const RICH_TEXT_KEYS = {
  strong: 'mod+b',
  em: 'mod+i',
  code: 'mod+e',
  del: 'mod+shift+x',
  link: 'mod+k',
  clearMarks: 'mod+\\',
  p: 'mod+alt+0',
  h2: 'mod+alt+2',
  h3: 'mod+alt+3',
  h4: 'mod+alt+4',
  h5: 'mod+alt+5',
  h6: 'mod+alt+6',
  ol: 'mod+shift+7',
  ul: 'mod+shift+8',
  blockquote: 'mod+shift+9',
  sink: 'mod+]',
  lift: 'mod+[',
  pastePlain: 'mod+shift+v',
  toolbar: 'alt+f10',
} as const;

/**
 * What the editor does when a shortcut fires.
 * A handler returns `false` to leave the key to the browser; anything else counts as handled.
 */
export interface RichTextKeyHandlers {
  /**
   * Toggles `mark` on the selection.
   */
  toggleMark(mark: RichTextMark): boolean | void;

  /**
   * Opens the link popup.
   */
  link(): boolean | void;

  /**
   * Removes every mark from the selection.
   */
  clearMarks(): boolean | void;

  /**
   * Turns the selected leaves into `type`.
   */
  setBlockType(type: RichTextBlockType): boolean | void;

  /**
   * Turns the selected leaves into a list, or list items back into paragraphs.
   */
  toggleList(ordered: boolean): boolean | void;

  /**
   * Nests the selected items one level deeper, returning whether it could.
   * Tab leaves the key to the browser when it could not, so focus moves on.
   */
  sinkItem(): boolean;

  /**
   * Lifts the selected items one level, returning whether it could.
   * Shift-Tab leaves the key to the browser when it could not, so focus moves on.
   */
  liftItem(): boolean;

  /**
   * Makes the next paste insert plain text.
   */
  pastePlain(): boolean | void;

  /**
   * Moves focus into the toolbar.
   */
  focusToolbar(): boolean | void;
}

/**
 * The subset of a browser `KeyboardEvent` the editor's shortcuts read.
 */
export interface RichTextKeyEvent extends KeyboardEventLike, ComposingEventLike {
  /**
   * The physical key, in `KeyboardEvent.code` form: `'Digit2'`, `'KeyB'`.
   */
  code: string;
}

/**
 * Answers whether a keydown ran one of the editor's shortcuts, so the caller cancels it.
 */
export type RichTextKeyMatcher = (event: RichTextKeyEvent) => boolean;

const HEADINGS = ['h2', 'h3', 'h4', 'h5', 'h6'] as const;

/**
 * Compiles the editor's shortcuts for a field, binding only the actions its options allow.
 * Without links there is no `mod+k`, so the palette keeps it.
 * In an inline value there are no block types, and a mark or element the field omits has no key.
 * A digit matches on `event.code`, so Shift and Option never hide it.
 * On platforms other than Mac, Ctrl-Alt plus a digit matches only when `event.key` is that digit.
 * AltGr then keeps typing the layout's `²`, `{` or `[`.
 * No shortcut runs while an input method is composing.
 */
export function richTextKeys(
  options: RichTextOptions,
  handlers: RichTextKeyHandlers,
  keymapOptions: KeymapOptions = {},
): RichTextKeyMatcher {
  const platform = keymapOptions.platform ?? detectPlatform();
  const {
    inline = false,
    elements = RICH_TEXT_DEFAULT_ELEMENTS,
    marks = RICH_TEXT_DEFAULT_MARKS,
    links = true,
  } = options;
  const keymap: Keymap = {
    [RICH_TEXT_KEYS.clearMarks]: () => handlers.clearMarks(),
    [RICH_TEXT_KEYS.pastePlain]: () => handlers.pastePlain(),
    [RICH_TEXT_KEYS.toolbar]: () => handlers.focusToolbar(),
    [RICH_TEXT_KEYS.sink]: () => void handlers.sinkItem(),
    [RICH_TEXT_KEYS.lift]: () => void handlers.liftItem(),
    tab: () => handlers.sinkItem(),
    'shift+tab': () => handlers.liftItem(),
  };

  for (const mark of RICH_TEXT_MARKS)
    if (marks.includes(mark)) keymap[RICH_TEXT_KEYS[mark]] = () => handlers.toggleMark(mark);
  if (links !== false) keymap[RICH_TEXT_KEYS.link] = () => handlers.link();
  if (!inline) {
    keymap[RICH_TEXT_KEYS.p] = () => handlers.setBlockType('p');
    for (const heading of HEADINGS)
      if (elements.includes(heading))
        keymap[RICH_TEXT_KEYS[heading]] = () => handlers.setBlockType(heading);
    if (elements.includes('ol')) keymap[RICH_TEXT_KEYS.ol] = () => handlers.toggleList(true);
    if (elements.includes('ul')) keymap[RICH_TEXT_KEYS.ul] = () => handlers.toggleList(false);
    if (elements.includes('blockquote'))
      keymap[RICH_TEXT_KEYS.blockquote] = () => handlers.setBlockType('blockquote');
  }

  const match = createKeymap(keymap, { platform });
  return (event) => {
    if (isComposing(event)) return false;
    const stroke = strokeOf(event, platform);
    return stroke ? match(stroke) : false;
  };
}

/**
 * The stroke to match, with a digit read from `event.code`, or nothing for an AltGr character.
 */
function strokeOf(event: RichTextKeyEvent, platform: Platform): KeyStroke | undefined {
  const stroke = strokeFromKeyboardEvent(event);
  const digit = /^Digit(\d)$/.exec(event.code)?.[1];
  if (!digit) return stroke;
  if (platform !== 'mac' && stroke.ctrl && stroke.alt && event.key !== digit) return undefined;
  return { ...stroke, key: digit };
}
