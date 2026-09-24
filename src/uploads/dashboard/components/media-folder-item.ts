import { css, h, icon, when } from 'ohnejs/dashboard';
import { ref, untracked } from 'ohnejs/utils';

import type { UploadRecord } from '../../uploads/types.ts';

import { lockPill } from './media-image-item.ts';
import { moveUploads } from './media-library-data.ts';
import { mediaPath, type MediaView } from './media-library-state.ts';

/**
 * Options for `mediaFolderItem`.
 */
export interface MediaFolderItemOptions {
  /**
   * The view the tile belongs to; a drop moves its selection into the folder.
   */
  view: MediaView;

  /**
   * Whether the tile accepts a drop while the view is moving.
   *
   * @default
   * true
   */
  allowDrop?: boolean;

  /**
   * Called on a plain click instead of navigating; a modified click still opens the link.
   */
  onPick?(record: UploadRecord, event: MouseEvent): void;
}

css`
  .o-media-folder-item {
    aspect-ratio: 1;
  }

  .o-media-folder-item-button {
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

  .o-media-folder-item-button:focus-visible {
    box-shadow:
      0 0 0 0.125rem hsl(var(--ohne-background)),
      0 0 0 0.25rem hsl(var(--ohne-ring)),
      0 0 #0000;
    outline: 0.125rem solid transparent;
    outline-offset: 0.125rem;
  }

  .o-media-folder-item-icon {
    pointer-events: none;
    font-size: 1.75rem;
  }

  .o-media-folder-item-icon [stroke] {
    stroke-width: 1;
  }

  .o-media-folder-lock {
    position: absolute;
    bottom: 0.5rem;
    right: 0.5rem;
  }

  /* Transparent to a drag, so the drop highlight never flickers while the pointer crosses it. */
  .o-media-library-moving .o-media-folder-lock {
    pointer-events: none;
  }

  @media (max-width: 767px) {
    .o-media-folder-lock {
      bottom: 0.375rem;
      right: 0.375rem;
    }
  }

  .o-media-item-selected .o-media-folder-item-button,
  .o-media-item-box:hover .o-media-folder-item-button,
  .o-media-item-box:focus-within .o-media-folder-item-button,
  .o-media-folder-item-highlighted .o-media-folder-item-button {
    background-color: hsl(var(--ohne-card));
    color: hsl(var(--ohne-card-foreground));
  }

  .o-media-item-selected .o-media-folder-item-button {
    border-color: hsl(var(--ohne-accent));
  }
`;

/**
 * A folder tile: a square link into the folder with the open-folder glyph.
 * A private folder wears a lock pill in the corner.
 * While the view is moving it is a drop target, highlighted under the dragged selection.
 * A drop moves the selection into the folder, unless the folder is part of it.
 */
export function mediaFolderItem(
  record: () => UploadRecord,
  options: MediaFolderItemOptions,
): HTMLElement {
  const view = options.view;
  const allowDrop = options.allowDrop ?? true;
  const highlighted = ref(false);
  const glyph = icon('folder-open');
  glyph.classList.add('o-media-folder-item-icon');

  const onDrop = (): void => {
    highlighted.value = false;
    if (!untracked(() => view.moving.value) || !allowDrop) return;
    const target = record();
    const selection = untracked(() => view.selection.value);
    if (selection.some((entry) => entry.UUID === target.UUID)) return;
    void moveUploads(selection, target.path);
  };

  return h(
    'div',
    {
      class: () =>
        'o-media-folder-item' +
        (view.moving.value && highlighted.value ? ' o-media-folder-item-highlighted' : ''),
    },
    h(
      'a',
      {
        href: () => mediaPath(record().path),
        target: options.onPick ? '_blank' : undefined,
        class: 'o-media-folder-item-button ohne-raw',
        onClick: (event: MouseEvent) => {
          if (options.onPick && !event.metaKey && !event.ctrlKey && !event.shiftKey) {
            event.preventDefault();
            options.onPick(record(), event);
          }
        },
        onDragenter: (event: DragEvent) => {
          event.preventDefault();
          highlighted.value = true;
        },
        onDragleave: () => {
          highlighted.value = false;
        },
        onDragover: (event: DragEvent) => event.preventDefault(),
        onDrop: (event: DragEvent) => {
          event.preventDefault();
          onDrop();
        },
      },
      glyph,
      when(
        () => record().private === true,
        () => lockPill('o-media-folder-lock'),
      ),
    ),
  );
}
