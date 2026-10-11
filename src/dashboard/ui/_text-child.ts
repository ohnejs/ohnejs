import type { Child } from '../render/insert.ts';

import { isPlainObject } from '../../utils/is/is-plain-object.ts';
import { isString } from '../../utils/is/is-string.ts';
import { effect } from '../../utils/reactive/effect.ts';
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
 * Renders content that is either `Text` or a `Child`.
 * A string or a `{ key, params }` pair resolves live in the active language.
 * Anything else is already a child; a getter renders as is, which is what `resolveText` would do.
 */
export function textChild(content: Text | Child): Child {
  return isText(content) ? () => resolveText(content) : content;
}

/**
 * Renders running text that is either `Text` or a `Child`, `Text` as markdown-lite in the surrounding type.
 * A backticked value in a message shows as code, exactly as it does in a toast or a dialog.
 * The text resolves live in the active language.
 */
export function proseChild(content: Text | Child): Child {
  if (!isText(content)) return content;
  const target = h('div', { class: 'ohne-prose ohne-text' });
  effect(() => renderProse(target, resolveText(content)));
  return target;
}

/**
 * Whether `content` is `Text` rather than a ready child.
 */
function isText(content: Text | Child): content is Text {
  return isString(content) || isPlainObject(content);
}
