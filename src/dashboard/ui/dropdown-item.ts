import type { Child } from '../render/insert.ts';

import { css } from '../render/css.ts';
import { h } from '../render/h.ts';
import { dropdownContainerOf } from './dropdown.ts';
import './tokens.ts';

/**
 * Options for `dropdownItem`.
 */
export interface DropdownItemOptions {
  /**
   * The HTML tag to render.
   * Omitted renders a `<button>`, or an `<a>` when `href` is set.
   */
  is?: 'a' | 'button' | 'span';

  /**
   * The link destination; the router intercepts same-origin navigation.
   * When set, the component renders as an `<a>` unless `is` overrides the tag.
   */
  href?: string;

  /**
   * The `target` attribute of the link.
   */
  target?: string;

  /**
   * The button's form role.
   * Omitted resolves to `'button'` unless `is` names a non-button tag.
   */
  type?: 'button' | 'submit' | 'reset';

  /**
   * Indents the content to align with icon-bearing sibling rows.
   *
   * @default
   * false
   */
  indent?: boolean;

  /**
   * Marks the row as a destructive action, highlighted in red on focus.
   *
   * @default
   * false
   */
  destructive?: boolean;

  /**
   * Click handler; a plain click on an `href` row still navigates through the router.
   */
  onClick?: (event: MouseEvent) => void;
}

css`
  .ohne-dropdown-item {
    display: flex;
    align-items: center;
    width: 100%;
    height: 2em;
    padding: 0 0.5em;
    border: none;
    background-color: hsl(var(--ohne-background));
    border-radius: calc(var(--ohne-radius) - 0.25rem);
    outline: none;
    color: hsl(var(--ohne-foreground));
    white-space: nowrap;
    text-decoration: none;
  }

  .ohne-dropdown-item-indent {
    padding-left: calc(2em + 0.125rem);
  }

  .ohne-dropdown-item:focus {
    background-color: hsl(var(--ohne-card) / 0.16);
  }

  .ohne-dropdown-item-destructive:focus {
    background-color: hsl(var(--ohne-destructive));
    color: hsl(var(--ohne-destructive-foreground));
  }

  .ohne-dropdown-item-inner {
    display: flex;
    align-items: center;
    gap: 0.5em;
    width: 100%;
    overflow: hidden;
    text-overflow: ellipsis;
    user-select: none;
  }

  .ohne-dropdown-item-inner > svg {
    flex-shrink: 0;
    font-size: calc(1em + 0.125rem);
  }

  .ohne-dropdown-item-inner > span {
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .ohne-dropdown-item-inner > kbd {
    flex-shrink: 0;
    display: flex;
    gap: 0.25em;
    margin-right: -0.25em;
    margin-left: auto;
    font-family: var(--ohne-font);
    font-size: calc(1em - 0.125rem);
    letter-spacing: 0.25em;
    opacity: 0.64;
  }

  .ohne-dropdown-item-inner > kbd > span {
    letter-spacing: initial;
  }

  .ohne-dropdown-item-inner > kbd > span:last-child {
    margin-right: 0.25em;
  }
`;

/**
 * One menu row inside a `dropdown`.
 *
 * Hover moves real focus, so the `:focus` styling doubles as the hover highlight.
 * Keyboard and mouse never desync.
 * Leaving a row refocuses the hosting popup, or blurs when the host is `<body>`.
 * Space activates the row like Enter, so links trigger from the keyboard too.
 * An `svg` child grows a step and a `span` child ellipsizes.
 * A `kbd` right-aligns as a shortcut hint.
 *
 * @example
 * ```ts
 * dropdownItem([icon('trash'), h('span', null, 'Delete')], { destructive: true })
 * ```
 */
export function dropdownItem(
  content: Child | (() => Child),
  options: DropdownItemOptions = {},
): HTMLElement {
  const tag = options.is ?? (options.href ? 'a' : 'button');
  const el = h(
    tag,
    {
      href: tag === 'a' ? options.href : undefined,
      target: options.target,
      type: options.type ?? (!options.is || options.is === 'button' ? 'button' : undefined),
      class:
        'ohne-dropdown-item ohne-raw' +
        (options.destructive ? ' ohne-dropdown-item-destructive' : '') +
        (options.indent ? ' ohne-dropdown-item-indent' : ''),
      onClick: options.onClick,
      onKeydown: (event: KeyboardEvent) => {
        if (event.key === ' ') el.click();
      },
      onMouseenter: () => el.focus(),
      onMouseleave: () => {
        const container = dropdownContainerOf(el);
        if (container && container.nodeName !== 'BODY') {
          container.focus();
        } else if (document.activeElement instanceof HTMLElement) {
          document.activeElement.blur();
        }
      },
    },
    h('span', { class: 'ohne-dropdown-item-inner' }, content),
  );
  return el;
}
