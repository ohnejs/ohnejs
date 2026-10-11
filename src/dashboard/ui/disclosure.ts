import type { Ref } from '../../utils/reactive/ref.ts';
import type { Child } from '../render/insert.ts';
import type { Text } from '../runtime/text.ts';

import { effect } from '../../utils/reactive/effect.ts';
import { ref } from '../../utils/reactive/ref.ts';
import { css } from '../render/css.ts';
import { h } from '../render/h.ts';
import { when } from '../render/when.ts';
import { textChild } from './_text-child.ts';
import { icon } from './icon.ts';
import './tokens.ts';

/**
 * Options for `disclosure`.
 */
export interface DisclosureOptions {
  /**
   * The always visible row that opens and closes the content.
   */
  summary: Text | Child;

  /**
   * Whether the content shows, read and written by the disclosure.
   * Omitted, the disclosure keeps its own state and starts closed.
   */
  open?: Ref<boolean>;

  /**
   * A name shared by sibling disclosures that makes them an accordion: opening one closes the others.
   */
  group?: string;
}

css`
  .ohne-disclosure {
    font-size: calc(1rem + var(--ohne-size) * 0.125rem);
  }

  .ohne-disclosure + .ohne-disclosure {
    border-top-width: 1px;
  }

  .ohne-disclosure-summary {
    display: flex;
    align-items: center;
    gap: 0.5em;
    padding: 0.625em 0;
    cursor: pointer;
    border-radius: calc(var(--ohne-radius) - 0.125rem);
    outline: none;
    font-weight: 500;
    list-style: none;
    user-select: none;
    transition: var(--ohne-transition);
    transition-property: box-shadow, color;
  }

  .ohne-disclosure-summary::-webkit-details-marker {
    display: none;
  }

  .ohne-disclosure-summary:focus-visible {
    box-shadow: 0 0 0 0.125rem hsl(var(--ohne-ring));
  }

  .ohne-disclosure-label {
    flex: 1;
    min-width: 0;
  }

  .ohne-disclosure-chevron {
    flex-shrink: 0;
    color: hsl(var(--ohne-muted-foreground));
    font-size: calc(1em + 0.125rem);
  }

  .ohne-disclosure[open] > .ohne-disclosure-summary > .ohne-disclosure-chevron {
    transform: rotate(180deg);
  }

  .ohne-disclosure-content {
    padding-bottom: 0.75em;
  }

  @media (prefers-reduced-motion: no-preference) {
    .ohne-disclosure-chevron {
      transition: transform 150ms cubic-bezier(0.4, 0, 0.2, 1);
    }
  }
`;

/**
 * A native `<details>` row that shows its content on demand, with a chevron that turns as it opens.
 * The content builds on the first open and stays mounted after, so its state survives closing.
 * Disclosures sharing a `group` form an exclusive accordion through the native `name` attribute.
 *
 * @example
 * ```ts
 * disclosure(() => 'Hearthstones cool down after thirty minutes.', { summary: 'Cooldowns' })
 *
 * disclosure(() => raidRules(), { summary: 'Raid rules', group: 'faq' })
 * disclosure(() => lootRules(), { summary: 'Loot rules', group: 'faq' })
 * ```
 */
export function disclosure(content: () => Child, options: DisclosureOptions): HTMLElement {
  const open = options.open ?? ref(false);
  const opened = ref(false);
  effect(() => {
    if (open.value) opened.value = true;
  });
  const el = h(
    'details',
    {
      class: 'ohne-disclosure',
      name: options.group,
      open: () => open.value,
      onToggle: () => {
        open.value = (el as HTMLDetailsElement).open;
      },
    },
    h(
      'summary',
      { class: 'ohne-disclosure-summary' },
      h('span', { class: 'ohne-disclosure-label' }, textChild(options.summary)),
      chevron(),
    ),
    h(
      'div',
      { class: 'ohne-disclosure-content' },
      when(() => opened.value, content),
    ),
  );
  return el;
}

/**
 * The muted chevron at the end of the summary row.
 */
function chevron(): SVGSVGElement {
  const svg = icon('chevron-down');
  svg.classList.add('ohne-disclosure-chevron');
  return svg;
}
