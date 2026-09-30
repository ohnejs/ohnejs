import { closePalette } from 'app/components/palette-state.ts';
import { css, type DashboardCollection, fallbackLabel, h, labelOf } from 'ohnejs/dashboard';
import { recordHref } from 'ohnejs/utils';

css`
  .o-record-link {
    display: inline-block;
    max-width: min(14em, 100%);
    overflow: hidden;
    vertical-align: bottom;
    color: hsl(var(--ohne-foreground));
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .o-record-link:hover {
    text-decoration: underline;
    text-underline-offset: 0.2em;
  }

  /* Restores the base focus ring, which ohne-raw opts out of. */
  .o-record-link:focus-visible {
    box-shadow:
      0 0 0 0.125rem hsl(var(--ohne-background)),
      0 0 0 0.25rem hsl(var(--ohne-ring));
    outline: 0.125rem solid transparent;
    border-radius: 0.125rem;
  }
`;

/**
 * Options for `recordLink`.
 */
export interface RecordLinkOptions {
  /**
   * Opens the record in a new tab and keeps the palette open.
   *
   * @default
   * false
   */
  newTab?: boolean;
}

/**
 * A record's label as a quiet link to its page, the whole label on hover when it is cut short.
 * The label comes from the label cache, or a short id while it loads.
 */
export function recordLink(
  collection: DashboardCollection,
  uuid: string,
  options: RecordLinkOptions = {},
): HTMLElement {
  const label = (): string => labelOf(collection.name, uuid) ?? fallbackLabel(uuid);
  return h(
    'a',
    {
      class: 'ohne-raw o-record-link',
      href: recordHref(collection, uuid),
      title: label,
      target: options.newTab === true ? '_blank' : undefined,
      onClick: options.newTab === true ? undefined : () => closePalette(),
    },
    label,
  );
}
