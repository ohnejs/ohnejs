import { css, h, icon, type IconName, when } from 'ohnejs/dashboard';
import { formatBytes, isUndefined, mediaCategory } from 'ohnejs/utils';

import type { UploadRecord } from '../../uploads/types.ts';

import {
  detailsHref,
  disabledIndicator,
  fileTileClick,
  lockPill,
  type MediaFileTileOptions,
  type MediaItemDisabled,
} from './media-image-item.ts';
import { privateUploads } from './media-library-data.ts';

const NOT_DISABLED: MediaItemDisabled = { value: false };

const TYPE_ICONS: Readonly<Record<string, IconName>> = {
  'text/css': 'file-type-css',
  'text/csv': 'file-type-csv',
  'application/msword': 'file-type-doc',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'file-type-docx',
  'text/html': 'file-type-html',
  'application/javascript': 'file-type-js',
  'text/jsx': 'file-type-jsx',
  'application/pdf': 'file-type-pdf',
  'application/php': 'file-type-php',
  'application/vnd.ms-powerpoint': 'file-type-ppt',
  'application/x-rust': 'file-type-rs',
  'application/sql': 'file-type-sql',
  'application/typescript': 'file-type-ts',
  'text/tsx': 'file-type-tsx',
  'text/plain': 'file-type-txt',
  'application/vue': 'file-type-vue',
  'application/vnd.ms-excel': 'file-type-xls',
  'application/zip': 'file-type-zip',
};

const CATEGORY_ICONS: Readonly<Record<string, IconName>> = {
  image: 'photo',
  audio: 'file-music',
  video: 'video',
  archive: 'file-zip',
  code: 'file-code',
  font: 'file-typography',
  document: 'file-description',
  text: 'file-text',
};

css`
  .o-media-file-item {
    aspect-ratio: 1;
  }

  .o-media-file-item-button {
    position: absolute;
    top: 0;
    right: 0;
    bottom: 0;
    left: 0;
    display: flex;
    justify-content: center;
    align-items: center;
    background-color: hsl(var(--ohne-background));
    border: 1px solid hsl(var(--ohne-border));
    border-radius: var(--ohne-radius);
    color: hsl(var(--ohne-foreground));
    transition: var(--ohne-transition);
    transition-property: background-color, border-color, box-shadow, color;
  }

  .o-media-file-item-button:focus-visible {
    box-shadow:
      0 0 0 0.125rem hsl(var(--ohne-background)),
      0 0 0 0.25rem hsl(var(--ohne-ring)),
      0 0 #0000;
    outline: 0.125rem solid transparent;
    outline-offset: 0.125rem;
  }

  .o-media-file-item-button-disabled {
    pointer-events: none;
  }

  .o-media-file-item-disabled .o-media-file-item-button {
    filter: blur(2px);
    opacity: 0.5;
  }

  .o-media-file-item-icon {
    pointer-events: none;
    font-size: 1.75rem;
  }

  .o-media-file-item-icon [stroke] {
    stroke-width: 1;
  }

  .o-media-file-item-disabled .o-media-file-item-icon {
    opacity: 0.5;
  }

  .o-media-file-item-disabled .o-media-file-item-icon [stroke] {
    stroke-width: 0.75;
  }

  .o-media-file-meta {
    position: absolute;
    bottom: 0.5rem;
    right: 0.5rem;
    display: flex;
    align-items: center;
    gap: 0.25rem;
  }

  .o-media-file-size {
    pointer-events: none;
    font-size: 0.75rem;
    line-height: 1rem;
    color: hsl(var(--ohne-muted-foreground));
  }

  .o-media-file-compact .o-media-file-meta {
    bottom: 0.375rem;
    right: 0.375rem;
  }

  .o-media-file-item-disabled-indicator {
    position: absolute;
    top: 0.5rem;
    right: 0.5rem;
    cursor: help;
  }

  @media (max-width: 767px) {
    .o-media-file-meta {
      bottom: 0.375rem;
      right: 0.375rem;
    }

    .o-media-file-item-disabled-indicator {
      top: 0.375rem;
      right: 0.375rem;
    }
  }

  .o-media-item-selected .o-media-file-item-button:not(.o-media-file-item-button-disabled),
  .o-media-item-box:hover .o-media-file-item-button:not(.o-media-file-item-button-disabled),
  .o-media-item-box:focus-within .o-media-file-item-button:not(.o-media-file-item-button-disabled) {
    background-color: hsl(var(--ohne-card));
    color: hsl(var(--ohne-card-foreground));
  }

  .o-media-item-selected .o-media-file-item-button {
    border-color: hsl(var(--ohne-accent));
  }
`;

/**
 * The glyph a file tile shows: the exact type's icon when one exists, else its category's, else a plain file.
 */
export function fileIcon(record: UploadRecord): IconName {
  const type = record.type ?? 'application/octet-stream';
  return TYPE_ICONS[type] ?? CATEGORY_ICONS[mediaCategory(type)] ?? 'file';
}

/**
 * A file tile: the type's glyph centered on a square, the byte size in the corner.
 * A private file wears a lock pill beside its size.
 * Hover, focus, and selection lift it onto a card-colored ground.
 * The link opens the file's details; a picker click picks or toggles instead.
 */
export function mediaFileItem(
  record: () => UploadRecord,
  options: MediaFileTileOptions,
): HTMLElement {
  const disabled = options.disabled ?? ((): MediaItemDisabled => NOT_DISABLED);
  const glyph = icon(fileIcon(record()));
  glyph.classList.add('o-media-file-item-icon');
  return h(
    'div',
    {
      class: () =>
        'o-media-file-item' +
        (disabled().value ? ' o-media-file-item-disabled' : '') +
        (options.compact ? ' o-media-file-compact' : ''),
    },
    h(
      'a',
      {
        href: () => detailsHref(record(), !isUndefined(options.onPick)),
        target: options.onPick ? '_blank' : undefined,
        class: () =>
          'o-media-file-item-button ohne-raw' +
          (disabled().value ? ' o-media-file-item-button-disabled' : ''),
        onClick: (event: MouseEvent) => fileTileClick(record, options, event),
      },
      glyph,
      h(
        'span',
        { class: 'o-media-file-meta' },
        when(
          () => privateUploads() && record().private === true,
          () => lockPill('o-media-file-lock'),
        ),
        h('span', { class: 'o-media-file-size' }, () => formatBytes(record().size ?? 0)),
      ),
    ),
    when(
      () => disabled().value,
      () =>
        disabledIndicator('o-media-file-item-disabled-indicator', () => {
          const state = disabled();
          return state.value ? state.reason : '';
        }),
    ),
  );
}
