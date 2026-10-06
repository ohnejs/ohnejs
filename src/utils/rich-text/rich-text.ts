import type { Link } from './link.ts';

/**
 * An inline formatting mark, named by its HTML element.
 */
export type RichTextMark = (typeof RICH_TEXT_MARKS)[number];

/**
 * A block element besides the paragraph, named by its HTML element.
 */
export type RichTextElement = (typeof RICH_TEXT_ELEMENTS)[number];

/**
 * A heading level, from `h2` to `h6`.
 */
export type RichTextHeadingLevel = 2 | 3 | 4 | 5 | 6;

/**
 * A stretch of text that shares one set of marks and at most one link.
 */
export interface RichTextRun<C extends string = string> {
  /**
   * The text, where `\n` is a line break.
   */
  text: string;

  /**
   * The marks on the text, in `RICH_TEXT_MARKS` order.
   *
   * @default
   * []
   */
  marks?: RichTextMark[];

  /**
   * The link the text opens.
   */
  link?: Link<C>;
}

/**
 * A paragraph of runs.
 */
export interface RichTextParagraph<C extends string = string> {
  /**
   * The block's kind.
   */
  kind: 'paragraph';

  /**
   * The paragraph's runs.
   */
  content: RichTextRun<C>[];
}

/**
 * A heading of runs.
 */
export interface RichTextHeading<C extends string = string> {
  /**
   * The block's kind.
   */
  kind: 'heading';

  /**
   * The heading level, so `2` renders as `h2`.
   */
  level: RichTextHeadingLevel;

  /**
   * The heading's runs.
   */
  content: RichTextRun<C>[];
}

/**
 * A quote of runs.
 * A quote with several lines separates them with `\n`.
 */
export interface RichTextQuote<C extends string = string> {
  /**
   * The block's kind.
   */
  kind: 'quote';

  /**
   * The quote's runs.
   */
  content: RichTextRun<C>[];
}

/**
 * A bulleted or numbered list.
 */
export interface RichTextList<C extends string = string> {
  /**
   * The block's kind.
   */
  kind: 'list';

  /**
   * Whether the list is numbered.
   */
  ordered: boolean;

  /**
   * The list's items.
   */
  items: RichTextListItem<C>[];
}

/**
 * A list item: its runs, then an optional nested list.
 */
export interface RichTextListItem<C extends string = string> {
  /**
   * The item's runs.
   */
  content: RichTextRun<C>[];

  /**
   * A list nested under the item.
   */
  list?: RichTextList<C>;
}

/**
 * A top-level block of a rich text value.
 */
export type RichTextBlock<C extends string = string> =
  | RichTextParagraph<C>
  | RichTextHeading<C>
  | RichTextQuote<C>
  | RichTextList<C>;

/**
 * A rich text value: a list of blocks, where `[]` is empty.
 * `C` narrows the collections its record links may point into.
 *
 * @example
 * ```ts
 * const value: RichText = [
 *   { kind: 'heading', level: 2, content: [{ text: 'Hello' }] },
 *   { kind: 'paragraph', content: [{ text: 'Read ' }, { text: 'this', marks: ['strong'] }] },
 * ]
 * ```
 */
export type RichText<C extends string = string> = RichTextBlock<C>[];

/**
 * What a rich text value may hold.
 */
export interface RichTextOptions {
  /**
   * Whether the value holds at most one paragraph, rendered without a block tag.
   * `elements` does not apply then.
   *
   * @default
   * false
   */
  inline?: boolean;

  /**
   * The block elements allowed besides paragraphs.
   *
   * @default
   * ['h2', 'h3', 'ul', 'ol', 'blockquote']
   */
  elements?: readonly RichTextElement[];

  /**
   * The marks allowed on text.
   *
   * @default
   * ['strong', 'em', 'code']
   */
  marks?: readonly RichTextMark[];

  /**
   * The links allowed on text.
   * `false` allows none, `true` allows URLs, and a list of collections also allows records in them.
   *
   * @default
   * true
   */
  links?: boolean | readonly string[];

  /**
   * Whether text keeps its line breaks.
   * With `false`, `normalizeRichText` turns each `\n` into a space.
   *
   * @default
   * true
   */
  lineBreaks?: boolean;
}

/**
 * One problem in a rich text value, at the path where it sits.
 *
 * @example
 * ```ts
 * const issue: RichTextIssue = { path: '[2].content[0].link.url', key: 'validation.invalidLink' }
 * ```
 */
export interface RichTextIssue {
  /**
   * Where the problem sits, in `[i]` and dot form, where `''` is the value itself.
   */
  path: string;

  /**
   * The message key that describes the problem.
   */
  key: `validation.${string}`;

  /**
   * The values the message interpolates.
   */
  params?: Record<string, unknown>;
}

/**
 * The marks, in the order a run lists them and a renderer nests them, from outer to inner.
 *
 * @example
 * ```ts
 * RICH_TEXT_MARKS.includes('em') // -> true
 * ```
 */
export const RICH_TEXT_MARKS = ['strong', 'em', 'del', 'code'] as const;

/**
 * The block elements a value may allow besides paragraphs.
 *
 * @example
 * ```ts
 * RICH_TEXT_ELEMENTS.includes('h4') // -> true
 * ```
 */
export const RICH_TEXT_ELEMENTS = ['h2', 'h3', 'h4', 'h5', 'h6', 'ul', 'ol', 'blockquote'] as const;
