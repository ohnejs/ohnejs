import { css, each, h } from 'ohne/dashboard';
import { ref, untracked } from 'ohne/utils';

import { useUploadsT } from './_messages.ts';
import { moveUploads } from './media-library-data.ts';
import { breadcrumbsOf, mediaPath, type MediaView } from './media-library-state.ts';

/**
 * Options for `mediaBreadcrumbs`.
 */
export interface MediaBreadcrumbsOptions {
  /**
   * The view whose folder the trail shows; a drop moves its selection into the segment's folder.
   */
  view: MediaView;

  /**
   * The query string the parent links carry, read reactively; `''` carries none.
   * The page keeps its view across folders this way, minus the page number.
   */
  search?: () => string;

  /**
   * Called on a plain click of a parent segment instead of navigating; a modified click still opens it.
   */
  onPick?(directory: string): void;
}

css`
  .o-media-breadcrumbs {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    font-weight: 500;
  }

  .o-media-breadcrumb {
    position: relative;
    display: flex;
    width: auto;
    text-decoration: none;
  }

  .o-media-breadcrumb:not(.o-media-breadcrumb-active),
  .o-media-breadcrumb-separator {
    color: hsl(var(--ohne-muted-foreground));
  }

  .o-media-breadcrumb:not(.o-media-breadcrumb-active):hover,
  .o-media-breadcrumb:not(.o-media-breadcrumb-active):focus {
    color: hsl(var(--ohne-foreground));
  }

  .o-media-breadcrumb::before {
    content: '';
    position: absolute;
    z-index: -1;
    top: -0.125rem;
    right: -0.375rem;
    bottom: -0.125rem;
    left: -0.375rem;
    background-color: hsl(var(--ohne-accent));
    border-radius: var(--ohne-radius);
    opacity: 0;
    visibility: hidden;
    transition: var(--ohne-transition);
    transition-property: opacity, visibility;
  }

  .o-media-breadcrumb * {
    pointer-events: none;
  }

  .o-media-breadcrumb-highlighted {
    color: hsl(var(--ohne-accent-foreground)) !important;
  }

  .o-media-breadcrumb-highlighted::before {
    opacity: 1;
    visibility: visible;
  }
`;

/**
 * The folder trail: the root, then one segment per folder, the current one plain and the rest links.
 * Every segment is a drop target while the view is moving; a drop moves the selection into that folder.
 */
export function mediaBreadcrumbs(options: MediaBreadcrumbsOptions): HTMLElement {
  const t = useUploadsT();
  const view = options.view;
  const highlighted = ref<string | null>(null);
  const crumbs = (): ReturnType<typeof breadcrumbsOf> => breadcrumbsOf(view.directory.value);
  const search = (): string => options.search?.() ?? '';

  const onDrop = (directory: string): void => {
    highlighted.value = null;
    if (!untracked(() => view.moving.value)) return;
    const selection = untracked(() => view.selection.value);
    if (selection.some((record) => record.path === directory)) return;
    void moveUploads(selection, directory);
  };

  const dropProps = (directory: string): Record<string, unknown> => ({
    onDragenter: (event: DragEvent) => {
      event.preventDefault();
      highlighted.value = directory;
    },
    onDragleave: () => {
      highlighted.value = null;
    },
    onDragover: (event: DragEvent) => event.preventDefault(),
    onDrop: (event: DragEvent) => {
      event.preventDefault();
      onDrop(directory);
    },
  });

  const classes = (directory: string, active: boolean): string =>
    'o-media-breadcrumb ohne-shrink-0' +
    (active ? ' o-media-breadcrumb-active' : '') +
    (view.moving.value && highlighted.value === directory ? ' o-media-breadcrumb-highlighted' : '');

  const link = (directory: string, label: string, active: boolean): HTMLElement =>
    active
      ? h(
          'span',
          { title: label, class: () => classes(directory, true), ...dropProps(directory) },
          label,
        )
      : h(
          'a',
          {
            href: () => mediaPath(directory, search()),
            target: options.onPick ? '_blank' : undefined,
            title: label,
            class: () => classes(directory, false),
            onClick: (event: MouseEvent) => {
              if (options.onPick && !event.metaKey && !event.ctrlKey && !event.shiftKey) {
                event.preventDefault();
                options.onPick(directory);
              }
            },
            ...dropProps(directory),
          },
          h('span', { class: 'ohne-truncate' }, label),
        );

  return h(
    'div',
    { class: 'o-media-breadcrumbs' },
    () => link('', t('uploads.dashboard.media'), crumbs().length === 0),
    each(
      crumbs,
      (crumb) => crumb.path,
      (crumb) => [
        h('span', { class: 'o-media-breadcrumb-separator ohne-shrink-0' }, '/'),
        () => {
          const { name, path } = crumb();
          return link(path, name, path === view.directory.value);
        },
      ],
    ),
  );
}
