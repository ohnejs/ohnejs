import type { HighlightToken } from '../../utils/highlight/highlight-token.ts';
import type { Ref } from '../../utils/reactive/ref.ts';
import type { TextEdit } from '../../utils/text/text-edit.ts';
import type { Child } from '../render/insert.ts';

import { tokenize } from '../../utils/highlight/tokenize.ts';
import { isUndefined } from '../../utils/is/is-undefined.ts';
import { createKeymap } from '../../utils/keys/create-keymap.ts';
import { isComposing } from '../../utils/keys/is-composing.ts';
import { strokeFromKeyboardEvent } from '../../utils/keys/stroke-from-keyboard-event.ts';
import { batchedEffect } from '../../utils/reactive/batched-effect.ts';
import { ref } from '../../utils/reactive/ref.ts';
import { toValue } from '../../utils/reactive/to-value.ts';
import { indentLines } from '../../utils/text/indent-lines.ts';
import { lineIndent } from '../../utils/text/line-indent.ts';
import { outdentLines } from '../../utils/text/outdent-lines.ts';
import { css } from '../render/css.ts';
import { h } from '../render/h.ts';
import { autosizeTextarea } from './_autosize.ts';
import './tokens.ts';

/**
 * Options for `codeEditor`.
 */
export interface CodeEditorOptions {
  /**
   * Size step of the component: -2 very small, -1 small, 0 default, 1 large, 2 very large.
   * Omitted inherits `--ohne-size` from the nearest ancestor.
   */
  size?: number;

  /**
   * Placeholder text shown while the editor is empty.
   * A getter reads reactively, so a translated placeholder resolves when its catalog lands.
   */
  placeholder?: string | (() => string);

  /**
   * The highlighting language: a name, an alias or a file path, as `languageOf` resolves them.
   * A getter reads reactively, so a sibling field can pick it.
   * A language nothing registered renders plain.
   */
  language?: string | (() => string);

  /**
   * What Tab inserts: that many spaces, or one tab.
   * A stored tab renders that many columns wide, four under `'tab'`.
   *
   * @default
   * 2
   */
  indent?: number | 'tab';

  /**
   * Soft-wraps long lines instead of scrolling sideways.
   *
   * @default
   * false
   */
  wrap?: boolean;

  /**
   * Whether a line number sits beside each line.
   *
   * @default
   * true
   */
  lineNumbers?: boolean;

  /**
   * The fewest visible lines.
   *
   * @default
   * 3
   */
  rows?: number;

  /**
   * The most visible lines; past them the editor scrolls inside itself.
   *
   * @default
   * 24
   */
  maxRows?: number;

  /**
   * Disables the editor reactively while it returns `true`.
   */
  disabled?: () => boolean;

  /**
   * The `id` attribute of the textarea element.
   */
  id?: string;

  /**
   * The `name` attribute of the textarea element.
   */
  name?: string;

  /**
   * The `autofocus` attribute of the textarea element.
   *
   * @default
   * false
   */
  autofocus?: boolean;

  /**
   * Called when the editor gains focus, with the value at that moment.
   */
  onFocus?: (event: FocusEvent, value: string) => void;

  /**
   * Called when the editor loses focus, with the value at that moment.
   */
  onBlur?: (event: FocusEvent, value: string) => void;
}

/**
 * The longest text the editor highlights, in characters.
 * Past it the lines render plain, so a keystroke never waits on the scan.
 */
export const HIGHLIGHT_LIMIT = 100_000;

/**
 * One rendered line: its text, the tokens clipped to it, and a key that changes when either does.
 */
interface CodeLine {
  text: string;
  spans: HighlightToken[];
  key: string;
}

css`
  .ohne-code {
    --ohne-base-size: var(--ohne-size);
    --ohne-code-gutter: calc(1.25em + var(--ohne-code-digits) * 1ch);
    position: relative;
    width: 100%;
    overflow: hidden;
    background-color: hsl(var(--ohne-card));
    border: 1px solid hsl(var(--ohne-input));
    border-radius: calc(var(--ohne-radius) - 0.125rem);
    font-size: calc(1rem + var(--ohne-size) * 0.125rem);
    transition: var(--ohne-transition);
    transition-property: border-color, box-shadow;
  }

  .ohne-code:not(.ohne-code-disabled):focus-within {
    border-color: transparent;
    box-shadow: 0 0 0 0.125rem hsl(var(--ohne-ring));
    outline: none;
  }

  .ohne-code:where(:has([aria-invalid='true'])) {
    --ohne-ring: var(--ohne-destructive);
    border-color: hsl(var(--ohne-destructive));
  }

  .ohne-code-disabled {
    --ohne-card: var(--ohne-muted);
    --ohne-foreground: var(--ohne-muted-foreground);
  }

  .ohne-code-plain {
    --ohne-code-gutter: 0.5em;
  }

  .ohne-code-input,
  .ohne-code-view {
    padding: calc(0.5em - 0.15625rem) 0.5em;
    overflow: auto;
    scrollbar-gutter: stable;
    font: 1em / 1.5 var(--ohne-font-mono);
    white-space: pre;
    overflow-wrap: normal;
  }

  .ohne-code-wrap .ohne-code-input,
  .ohne-code-wrap .ohne-code-view {
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }

  .ohne-code-input {
    display: block;
    width: 100%;
    min-height: calc(var(--ohne-code-rows) * 1.5em + 1em - 0.3125rem);
    max-height: calc(var(--ohne-code-max-rows) * 1.5em + 1em - 0.3125rem);
    padding-left: var(--ohne-code-gutter);
    background-color: transparent;
    border: none;
    outline: none;
    resize: none;
    color: transparent;
    caret-color: hsl(var(--ohne-foreground));
  }

  .ohne-code-input::placeholder {
    color: hsl(var(--ohne-muted-foreground));
  }

  .ohne-code-view {
    position: absolute;
    inset: 0;
    padding-left: 0;
    counter-reset: ohne-code-line;
    /* The twin scrolls only with the textarea, never to keep its rebuilt lines in place. */
    overflow-anchor: none;
    color: hsl(var(--ohne-foreground));
    pointer-events: none;
  }

  /* Every line spans the widest one, so a sticky number keeps its room when scrolled sideways. */
  .ohne-code-lines {
    width: max-content;
    min-width: 100%;
  }

  .ohne-code-wrap .ohne-code-lines {
    width: auto;
  }

  .ohne-code-line {
    min-height: 1.5em;
    padding-left: var(--ohne-code-gutter);
  }

  .ohne-code-line::before {
    content: counter(ohne-code-line);
    counter-increment: ohne-code-line;
    position: sticky;
    left: 0;
    display: inline-block;
    /* The base reset's :where() cannot name a pseudo-element, so the gutter sizes itself. */
    box-sizing: border-box;
    width: var(--ohne-code-gutter);
    margin-left: calc(-1 * var(--ohne-code-gutter));
    padding-right: 0.75em;
    background-color: hsl(var(--ohne-card));
    color: hsl(var(--ohne-muted-foreground));
    text-align: right;
  }

  .ohne-code-plain .ohne-code-line::before {
    display: none;
  }
`;

/**
 * A code editor: a native textarea under a highlighted twin that shares its every metric.
 * The textarea keeps selection, input methods, paste and accessibility; the twin paints the colors.
 * Typing writes into the model; writing the model updates the textarea.
 * Tab indents, Shift+Tab, `mod+[` and `mod+]` outdent and indent, Enter keeps the indent, Escape blurs.
 * The height follows the content from `rows` to `maxRows` lines, then the editor scrolls inside itself.
 * The twin follows the textarea's scroll on every value write and every scroll, the browser's own included.
 *
 * @example
 * ```ts
 * const source = ref('')
 * codeEditor(source, { language: 'ts' })
 * ```
 */
export function codeEditor(model: Ref<string>, options: CodeEditorOptions = {}): HTMLElement {
  const { indent = 2, rows = 3, maxRows = 24, lineNumbers = true } = options;
  const unit = indent === 'tab' ? '\t' : ' '.repeat(indent);
  const digits = ref(1);
  let keys: string[] = [];

  const sheet = h('div', { class: 'ohne-code-lines' });
  const view = h('pre', { class: 'ohne-code-view', 'aria-hidden': 'true' }, sheet);
  const area = h('textarea', {
    class: 'ohne-code-input',
    autocapitalize: 'off',
    autocomplete: 'off',
    autocorrect: 'off',
    autofocus: options.autofocus ?? false,
    disabled: options.disabled,
    id: options.id,
    name: options.name,
    placeholder: options.placeholder,
    spellcheck: 'false',
    wrap: options.wrap ? undefined : 'off',
  }) as HTMLTextAreaElement;

  const render = (text: string, language: string): void => {
    const lines = splitLines(text, text.length > HIGHLIGHT_LIMIT ? [] : tokenize(text, language));
    const next = lines.map((line) => line.key);
    let head = 0;
    while (head < keys.length && head < next.length && keys[head] === next[head]) head += 1;
    let tail = 0;
    while (
      tail < keys.length - head &&
      tail < next.length - head &&
      keys[keys.length - 1 - tail] === next[next.length - 1 - tail]
    ) {
      tail += 1;
    }
    for (let stale = keys.length - head - tail; stale > 0; stale -= 1)
      sheet.childNodes[head].remove();
    const fragment = document.createDocumentFragment();
    for (const line of lines.slice(head, lines.length - tail))
      fragment.appendChild(lineElement(line));
    sheet.insertBefore(fragment, sheet.childNodes[head] ?? null);
    keys = next;
    digits.value = String(lines.length).length;
  };

  const edit = (change: TextEdit): void => {
    area.setSelectionRange(change.from, change.to);
    if (!document.execCommand?.('insertText', false, change.insert)) {
      area.setRangeText(change.insert, change.from, change.to);
      area.dispatchEvent(new Event('input', { bubbles: true }));
    }
    area.setSelectionRange(change.start, change.end);
  };
  const typed = (text: string): void => {
    const { selectionStart: from, selectionEnd: to } = area;
    edit({ from, to, insert: text, start: from + text.length, end: from + text.length });
  };
  const reindent = (change: typeof indentLines): void =>
    edit(change(area.value, area.selectionStart, area.selectionEnd, unit));
  const match = createKeymap({
    tab: () => {
      const selected = area.value.slice(area.selectionStart, area.selectionEnd);
      if (selected.includes('\n')) reindent(indentLines);
      else typed(unit);
    },
    'shift+tab': () => reindent(outdentLines),
    'mod+]': () => reindent(indentLines),
    'mod+[': () => reindent(outdentLines),
    enter: () => typed(`\n${lineIndent(area.value, area.selectionStart)}`),
    escape: () => area.blur(),
  });

  area.addEventListener('input', () => {
    model.value = area.value;
  });
  area.addEventListener('keydown', (event) => {
    if (isComposing(event) || !match(strokeFromKeyboardEvent(event))) return;
    event.preventDefault();
    event.stopPropagation();
  });
  const follow = (): void => {
    view.scrollTop = area.scrollTop;
    view.scrollLeft = area.scrollLeft;
  };
  area.addEventListener('scroll', follow);
  if (options.onFocus) {
    const onFocus = options.onFocus;
    area.addEventListener('focus', (event) => onFocus(event, area.value));
  }
  if (options.onBlur) {
    const onBlur = options.onBlur;
    area.addEventListener('blur', (event) => onBlur(event, area.value));
  }

  const autosize = autosizeTextarea(area);
  batchedEffect(() => {
    const text = model.value;
    if (area.value !== text) area.value = text;
    render(text, toValue(options.language) ?? '');
    autosize();
    follow();
  });
  const style =
    `--ohne-code-rows: ${rows}; --ohne-code-max-rows: ${maxRows}; ` +
    `tab-size: ${indent === 'tab' ? 4 : indent}` +
    (isUndefined(options.size) ? '' : `; --ohne-size: ${options.size}`);
  return h(
    'div',
    {
      class: () =>
        'ohne-code' +
        (options.wrap ? ' ohne-code-wrap' : '') +
        (lineNumbers ? '' : ' ohne-code-plain') +
        (options.disabled?.() ? ' ohne-code-disabled' : ''),
      style: () => `${style}; --ohne-code-digits: ${digits.value}`,
      onDblclick: (event: MouseEvent) => event.stopPropagation(),
    },
    area,
    view,
  );
}

/**
 * Splits `text` into lines, each with the tokens that touch it clipped to its own offsets.
 * A token spanning several lines lands on each of them.
 */
function splitLines(text: string, tokens: readonly HighlightToken[]): CodeLine[] {
  const lines: CodeLine[] = [];
  let at = 0;
  for (let from = 0; from <= text.length; ) {
    const close = text.indexOf('\n', from);
    const to = close === -1 ? text.length : close;
    const line = text.slice(from, to);
    const spans: HighlightToken[] = [];
    let key = line;
    while (at < tokens.length && tokens[at].start < to) {
      const token = tokens[at];
      const start = Math.max(token.start, from) - from;
      const end = Math.min(token.end, to) - from;
      if (end > start) {
        spans.push({ kind: token.kind, start, end });
        key += `\n${token.kind}${start},${end}`;
      }
      if (token.end > to) break;
      at += 1;
    }
    lines.push({ text: line, spans, key });
    from = to + 1;
  }
  return lines;
}

/**
 * Builds one line from text nodes and a `tk-<kind>` span per token.
 */
function lineElement({ text, spans }: CodeLine): HTMLElement {
  const children: Child[] = [];
  let at = 0;
  for (const { kind, start, end } of spans) {
    if (start > at) children.push(text.slice(at, start));
    children.push(h('span', { class: `tk-${kind}` }, text.slice(start, end)));
    at = end;
  }
  if (at < text.length) children.push(text.slice(at));
  return h('div', { class: 'ohne-code-line' }, children);
}
