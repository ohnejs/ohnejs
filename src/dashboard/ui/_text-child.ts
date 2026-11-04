import type { Child } from '../render/insert.ts';

import { codeSpanText } from '../../utils/ansi/code-span-text.ts';
import { codeSpans } from '../../utils/ansi/code-spans.ts';
import { stripCodeSpans } from '../../utils/i18n/strip-code-spans.ts';
import { isFunction } from '../../utils/is/is-function.ts';
import { isPlainObject } from '../../utils/is/is-plain-object.ts';
import { isString } from '../../utils/is/is-string.ts';
import { css } from '../render/css.ts';
import { h } from '../render/h.ts';
import { resolveText, type Text } from '../runtime/text.ts';
import { renderProse } from './prose.ts';

css`
  .ohne-prose.ohne-text {
    font-size: inherit;
    line-height: inherit;
  }
`;

/**
 * Renders a label that is either `Text` or a `Child`, a backticked value as plain text.
 * A string, a `{ key, params }` pair, or a getter's string resolves live in the active language.
 * Any other child renders as is.
 */
export function textChild(content: Text | Child): Child {
  return textOr(content, stripCodeSpans);
}

/**
 * Renders a heading that is either `Text` or a `Child`, a backticked value as an inline code chip.
 * A string, a `{ key, params }` pair, or a getter's string resolves live in the active language.
 * Any other child renders as is.
 */
export function inlineChild(content: Text | Child): Child {
  return textOr(content, codeRuns);
}

/**
 * Renders running text that is either `Text` or a `Child`, `Text` as markdown-lite in the surrounding type.
 * A backticked value in a message shows as code, exactly as it does in a toast or a dialog.
 * A string, a `{ key, params }` pair, or a getter's string resolves live in the active language.
 * Any other child renders as is.
 */
export function proseChild(content: Text | Child): Child {
  return textOr(content, proseBlock);
}

/**
 * A live child that renders the resolved string of `content` through `render`, or `content` itself.
 */
function textOr(content: Text | Child, render: (text: string) => Child): Child {
  if (isString(content) || isPlainObject(content)) return () => render(resolveText(content));
  if (!isFunction<() => Child>(content)) return content;
  return () => {
    const value = content();
    return isString(value) ? render(value) : value;
  };
}

/**
 * The text runs of `text`, each backtick code span as a `code` chip.
 */
function codeRuns(text: string): Child {
  const { ends } = codeSpans(text);
  if (ends.size === 0) return text;
  const runs: Child[] = [];
  let cursor = 0;
  for (const [start, end] of ends) {
    const code = codeSpanText(text.slice(start, end));
    runs.push(text.slice(cursor, start), h('code', { class: 'ohne-inline-code' }, code));
    cursor = end;
  }
  runs.push(text.slice(cursor));
  return runs;
}

/**
 * A block that renders `text` as markdown-lite in the surrounding type.
 */
function proseBlock(text: string): HTMLElement {
  const target = h('div', { class: 'ohne-prose ohne-text' });
  renderProse(target, text);
  return target;
}
