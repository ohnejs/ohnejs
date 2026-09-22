import { attachTooltip, button, css, h, icon, when } from 'ohnejs/dashboard';
import {
  formatBytes,
  isNull,
  isUndefined,
  onCleanup,
  parseSearchParams,
  stringifySearchParams,
} from 'ohnejs/utils';

import type { UploadRecord } from '../../uploads/types.ts';

import { useUploadsT } from './_messages.ts';
import { previewURL } from './media-library-data.ts';
import { mediaPath, type MediaSelectionMode, type MediaView } from './media-library-state.ts';

/**
 * Whether a tile is disabled, and why when it is; the picker greys out files a field cannot take.
 */
export type MediaItemDisabled = { value: false } | { value: true; reason: string };

/**
 * Options for `mediaImageItem` and `mediaFileItem`.
 */
export interface MediaFileTileOptions {
  /**
   * The view the tile belongs to; a multiple-mode click toggles the record in its selection.
   */
  view: MediaView;

  /**
   * How the library selects.
   *
   * @default
   * 'none'
   */
  selectionMode?: MediaSelectionMode;

  /**
   * Whether the tile is disabled, read reactively.
   * A disabled tile blurs, loses its pointer events, and shows the reason in a corner tooltip.
   */
  disabled?: () => MediaItemDisabled;

  /**
   * Called on a plain click instead of following the details link; a modified click still opens it.
   */
  onPick?(record: UploadRecord, event: MouseEvent): void;

  /**
   * Called on a plain click to open the file's details over the live page, instead of following the link.
   * `onPick` and multiple selection take precedence.
   */
  onDetails?(record: UploadRecord): void;

  /**
   * Tightens the corner captions, for a smaller tile.
   *
   * @default
   * false
   */
  compact?: boolean;
}

const NOT_DISABLED: MediaItemDisabled = { value: false };

const CHECKER_LIGHT =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABQAAAAUCAYAAACNiR0NAAAACXBIWXMAAAsTAAALEwEAmpwYAAAAAXNSR0IArs4c6QAAAARnQU1BAACxjwv8YQUAAAA5SURBVHgB7dGxEQAgDELRxDHYfzVYIzoChYXnQf3vNTTJKWMAnKxWXV7AgC+APWdOKMnJckrAP8ENTFgK0Z64q28AAAAASUVORK5CYII=';

const CHECKER_DARK =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABQAAAAUCAYAAACNiR0NAAAACXBIWXMAAAsTAAALEwEAmpwYAAAAAXNSR0IArs4c6QAAAARnQU1BAACxjwv8YQUAAAA/SURBVHgB7dOhEQAgDAPAwGFrmAEGYP+dMB0AVoio6PUSnXuTS1v7PBBxv0wNHcERKDADONgHmE2qp1EElgQ/ufgHd9nZw0oAAAAASUVORK5CYII=';

css`
  .o-media-image-item {
    aspect-ratio: 1;
  }

  .o-media-image-item-button {
    position: absolute;
    top: 0;
    right: 0;
    bottom: 0;
    left: 0;
    display: flex;
    justify-content: center;
    align-items: center;
    overflow: hidden;
    background-image: url('${CHECKER_LIGHT}');
    background-color: hsl(var(--ohne-background));
    border: 1px solid hsl(var(--ohne-border));
    border-radius: var(--ohne-radius);
    color: hsl(var(--ohne-foreground));
    transition: var(--ohne-transition);
    transition-property: background-color, border-color, box-shadow, color;
  }

  .o-media-image-item-button:focus-visible {
    box-shadow:
      0 0 0 0.125rem hsl(var(--ohne-background)),
      0 0 0 0.25rem hsl(var(--ohne-ring)),
      0 0 #0000;
    outline: 0.125rem solid transparent;
    outline-offset: 0.125rem;
  }

  .dark .o-media-image-item-button {
    background-image: url('${CHECKER_DARK}');
  }

  .o-media-image-item-disabled .o-media-image-item-button {
    background-image: none;
    filter: blur(2px);
    opacity: 0.5;
  }

  .o-media-image-item-button::before {
    content: '';
    position: absolute;
    top: 0;
    right: 0;
    bottom: 0;
    left: 0;
    pointer-events: none;
    background-color: hsl(var(--ohne-card));
    opacity: 0;
    transition: var(--ohne-transition);
    transition-property: opacity;
  }

  .o-media-image-item-button-disabled {
    pointer-events: none;
  }

  .o-media-image-thumbnail {
    position: absolute;
    top: 50%;
    left: 50%;
    max-width: 100%;
    max-height: 100%;
    object-fit: contain;
    pointer-events: none;
    transform: translate3d(-50%, -50%, 0);
    transition: var(--ohne-transition);
    transition-property: max-height;
  }

  .o-media-image-item-disabled .o-media-image-thumbnail {
    max-height: 50%;
    filter: grayscale(100%);
    opacity: 0.5;
  }

  .o-media-lock,
  .o-media-image-dimensions,
  .o-media-image-size {
    padding: 0 0.1875rem;
    font-size: 0.75rem;
    line-height: 1rem;
    background-color: hsl(var(--ohne-muted));
    border-radius: 0.25rem;
    color: hsl(var(--ohne-muted-foreground));
  }

  .o-media-lock {
    display: inline-flex;
    align-items: center;
    height: 1rem;
  }

  .o-media-image-dimensions {
    position: absolute;
    top: 0.5rem;
    left: 0.5rem;
    pointer-events: none;
  }

  .o-media-image-compact .o-media-image-dimensions {
    top: 0.375rem;
    left: 0.375rem;
  }

  .o-media-image-meta {
    position: absolute;
    bottom: 0.5rem;
    right: 0.5rem;
    display: flex;
    gap: 0.25rem;
  }

  .o-media-image-size {
    pointer-events: none;
  }

  .o-media-image-compact .o-media-image-meta {
    bottom: 0.375rem;
    right: 0.375rem;
  }

  .o-media-image-disabled-indicator {
    position: absolute;
    top: 0.5rem;
    right: 0.5rem;
    cursor: help;
  }

  @media (max-width: 767px) {
    .o-media-image-dimensions {
      top: 0.375rem;
      left: 0.375rem;
    }

    .o-media-image-meta {
      bottom: 0.375rem;
      right: 0.375rem;
    }

    .o-media-image-disabled-indicator {
      top: 0.375rem;
      right: 0.375rem;
    }
  }

  .o-media-item-selected .o-media-image-item-button:not(.o-media-image-item-button-disabled),
  .o-media-item-box:hover .o-media-image-item-button:not(.o-media-image-item-button-disabled),
  .o-media-item-box:focus-within
    .o-media-image-item-button:not(.o-media-image-item-button-disabled) {
    background-color: hsl(var(--ohne-card));
    color: hsl(var(--ohne-card-foreground));
  }

  .o-media-item-selected .o-media-image-item-button {
    border-color: hsl(var(--ohne-accent));
  }

  .o-media-item-selected
    .o-media-image-item-button:not(.o-media-image-item-button-disabled)::before,
  .o-media-item-box:hover
    .o-media-image-item-button:not(.o-media-image-item-button-disabled)::before,
  .o-media-item-box:focus-within
    .o-media-image-item-button:not(.o-media-image-item-button-disabled)::before {
    opacity: 1;
  }

  .o-media-item-selected .o-media-image-thumbnail,
  .o-media-item-box:hover .o-media-image-thumbnail,
  .o-media-item-box:focus-within .o-media-image-thumbnail {
    max-height: 50%;
  }
`;

/**
 * The details link of a file: the folder's path with `details` set to the record.
 * On the page the current view carries over; inside a picker the link opens bare in a new tab.
 */
export function detailsHref(record: UploadRecord, bare: boolean): string {
  const params = bare ? {} : parseSearchParams(location.search);
  return mediaPath(
    record.directory,
    `?${stringifySearchParams({ ...params, details: record.UUID })}`,
  );
}

/**
 * The click a file tile's link takes.
 * A plain click picks, toggles, or opens the details through `onDetails` instead of following the link.
 * A Cmd, Ctrl, or Shift click, or a click on a tile with nothing to pick, toggle, or open, follows the link.
 */
export function fileTileClick(
  record: () => UploadRecord,
  options: MediaFileTileOptions,
  event: MouseEvent,
): void {
  const multiple = options.selectionMode === 'multiple';
  const opens = options.onPick || multiple ? undefined : options.onDetails;
  if (!(options.onPick || multiple || opens) || event.metaKey || event.ctrlKey || event.shiftKey)
    return;
  event.preventDefault();
  if (options.disabled?.().value) return;
  const current = record();
  options.onPick?.(current, event);
  if (multiple) {
    if (options.view.isSelected(current.UUID)) options.view.deselect(current);
    else options.view.select(current);
  }
  opens?.(current);
}

/**
 * The corner glyph of a disabled tile, its reason in a tooltip.
 */
export function disabledIndicator(className: string, reason: () => string): HTMLElement {
  const el = button(icon('forbid'), { is: 'span', size: -3, variant: 'ghost', class: className });
  onCleanup(attachTooltip(el, reason));
  return el;
}

/**
 * The corner pill marking a private row, its meaning in a tooltip.
 */
export function lockPill(className: string): HTMLElement {
  const t = useUploadsT();
  const el = h('span', { class: `o-media-lock ${className}` }, icon('lock'));
  onCleanup(attachTooltip(el, () => t('uploads.dashboard.private')));
  return el;
}

/**
 * An image tile: the thumbnail over a checkerboard, its byte size in a corner caption.
 * A sized image also captions its pixel dimensions; a private one wears a lock pill beside its size.
 * Hover, focus, and selection shrink the thumbnail onto a card-colored ground.
 * The link opens the file's details; a picker click picks or toggles instead.
 */
export function mediaImageItem(
  record: () => UploadRecord,
  options: MediaFileTileOptions,
): HTMLElement {
  const disabled = options.disabled ?? ((): MediaItemDisabled => NOT_DISABLED);
  return h(
    'div',
    {
      class: () =>
        'o-media-image-item' +
        (disabled().value ? ' o-media-image-item-disabled' : '') +
        (options.compact ? ' o-media-image-compact' : ''),
    },
    h(
      'a',
      {
        href: () => detailsHref(record(), !isUndefined(options.onPick)),
        target: options.onPick ? '_blank' : undefined,
        class: () =>
          'o-media-image-item-button ohne-raw' +
          (disabled().value ? ' o-media-image-item-button-disabled' : ''),
        onClick: (event: MouseEvent) => fileTileClick(record, options, event),
      },
      h('img', {
        alt: () => record().description ?? '',
        src: () => previewURL(record()),
        loading: 'lazy',
        class: 'o-media-image-thumbnail',
      }),
      when(
        () => !isNull(record().width) && !isNull(record().height),
        () =>
          h(
            'span',
            { class: 'o-media-image-dimensions' },
            () => `${record().width} x ${record().height}`,
          ),
      ),
      h(
        'span',
        { class: 'o-media-image-meta' },
        when(
          () => record().private,
          () => lockPill('o-media-image-lock'),
        ),
        h('span', { class: 'o-media-image-size' }, () => formatBytes(record().size ?? 0)),
      ),
    ),
    when(
      () => disabled().value,
      () =>
        disabledIndicator('o-media-image-disabled-indicator', () => {
          const state = disabled();
          return state.value ? state.reason : '';
        }),
    ),
  );
}
