import type { MaybeGetter } from '../../utils/reactive/to-value.ts';

import { isUndefined } from '../../utils/is/is-undefined.ts';
import { toValue } from '../../utils/reactive/to-value.ts';
import { hashText } from '../../utils/text/hash-text.ts';
import { initials } from '../../utils/text/initials.ts';
import { css } from '../render/css.ts';
import { h } from '../render/h.ts';
import './tokens.ts';

/**
 * Options for `avatar`.
 */
export interface AvatarOptions {
  /**
   * The image URL; a getter keeps it live.
   * Omitted, or a getter answering `undefined`, shows the initials instead.
   */
  src?: MaybeGetter<string | undefined>;

  /**
   * Size step of the component: -2 very small, -1 small, 0 default, 1 large, 2 very large.
   * Omitted inherits `--ohne-size` from the nearest ancestor.
   */
  size?: number;
}

const CHART_SLOTS = 8;

css`
  .ohne-avatar {
    flex-shrink: 0;
    display: inline-flex;
    justify-content: center;
    align-items: center;
    width: 2em;
    height: 2em;
    overflow: hidden;
    border-radius: 50%;
    background-color: hsl(var(--ohne-avatar) / 0.16);
    color: color-mix(in srgb, hsl(var(--ohne-avatar)), hsl(var(--ohne-foreground)) 35%);
    font-size: calc(1rem + var(--ohne-size) * 0.125rem);
    font-weight: 600;
    line-height: 1;
    user-select: none;
  }

  .ohne-avatar-initials {
    font-size: 0.8125em;
  }

  .ohne-avatar img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }
`;

/**
 * A round picture of a person, or their initials when there is no picture.
 * The initials sit on a chart color picked by the name, so one name always wears the same color.
 * The name is the accessible label either way.
 *
 * @example
 * ```ts
 * avatar('Jaina Proudmoore')
 * avatar(() => user.value.name, { src: () => user.value.photo, size: 2 })
 * ```
 */
export function avatar(name: MaybeGetter<string>, options: AvatarOptions = {}): HTMLElement {
  const { size, src } = options;
  return h(
    'span',
    {
      class: 'ohne-avatar',
      role: 'img',
      'aria-label': () => toValue(name),
      style: () =>
        `--ohne-avatar: var(--ohne-chart-${(hashText(toValue(name)) % CHART_SLOTS) + 1})` +
        (isUndefined(size) ? '' : `; --ohne-size: ${size}`),
    },
    () => {
      const url = toValue(src);
      return isUndefined(url)
        ? h('span', { class: 'ohne-avatar-initials', 'aria-hidden': 'true' }, () =>
            initials(toValue(name)),
          )
        : h('img', { src: url, alt: '' });
    },
  );
}
