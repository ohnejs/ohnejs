import {
  button,
  card,
  type Child,
  css,
  type DashboardCollection,
  dashboardMeta,
  each,
  fieldLabel,
  h,
  icon,
  type IconName,
  loaded,
  menu,
  type MenuItem,
  openDialog,
  popup,
  type Popup,
  type PopupClose,
  toast,
  useAction,
  useResource,
  useT,
  when,
} from 'ohnejs/dashboard';
import {
  computed,
  deepEqual,
  effect,
  hasCapability,
  hasRoute,
  isEmpty,
  isNull,
  parseSearchParams,
  ref,
  untracked,
} from 'ohnejs/utils';

import type { BookmarkEntry, BookmarkList } from '../../bookmarks/types.ts';

import { bookmarkNamePopup, type BookmarkNamePopupOptions } from './bookmark-name-popup.ts';

/**
 * Options for `bookmarksPopup`.
 */
export interface BookmarksPopupOptions {
  /**
   * The collection whose table the bookmarks belong to.
   */
  collection: DashboardCollection;

  /**
   * The table's current view, its canonical query string without the leading `?`.
   * New and Update save it, and every bookmark of the same view is marked applied.
   */
  view: string;

  /**
   * Called with the view to apply, right before the popup asks to close.
   * The caller navigates to it once the close resolves.
   */
  onApply(view: string): void;

  /**
   * Called when the popup asks to close, with its animated close function.
   * The caller awaits it and then disposes the region that created the popup.
   */
  onClose(close: PopupClose): void;
}

css`
  .o-bookmarks-title {
    font-weight: 500;
  }

  .o-bookmarks-body {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    gap: var(--ohne-gap);
  }

  .o-bookmarks .ohne-field > * + * {
    margin-top: 0.75rem;
  }

  .o-bookmarks .ohne-field:not([hidden]) ~ .ohne-field:not([hidden]) {
    margin-top: 1.5rem;
  }

  .o-bookmarks-list > .ohne-card:not(:first-child) {
    margin-top: -1px;
    border-top-right-radius: 0;
    border-top-left-radius: 0;
  }

  .o-bookmarks-list > .ohne-card:not(:last-child) {
    border-bottom-right-radius: 0;
    border-bottom-left-radius: 0;
  }
`;

/**
 * The table bookmarks popup: the declared view, your own bookmarks, and the ones shared with you.
 *
 * Every row applies its view and sets it as your default.
 * A match of the current view, and your default, are marked.
 * Your own rows add a menu: Update, Share or Stop sharing, Rename, and a confirmed Delete.
 * New names the current view in a nested popup.
 * Each write checks its own route in the discovery data, and sharing also takes `dashboard.bookmarks.share`.
 * A shared row of yours needs that capability to change its name or view, as the server does.
 * The list is a shared `useResource`, so a reopen shows at once, and every write reloads it.
 * Setting a default never navigates; the table opens on it at your next bare visit.
 * Create it inside a reactive region; dispose the region after `onClose`'s close resolves.
 */
export function bookmarksPopup(options: BookmarksPopupOptions): Popup {
  const t = useT();
  const { segment } = options.collection;
  const meta = untracked(dashboardMeta);
  const serves = (route: string): boolean => hasRoute(meta?.routes ?? [], route);
  const canCreate = serves('POST /dashboard/bookmarks/[collection]');
  const canUpdate = serves('PATCH /dashboard/bookmarks/[collection]/[uuid]');
  const canDelete = serves('DELETE /dashboard/bookmarks/[collection]/[uuid]');
  const canDefault = serves('PUT /dashboard/bookmarks/[collection]/default');
  const canShare =
    canUpdate && hasCapability(meta?.capabilities ?? [], 'dashboard.bookmarks.share');
  const params = { collection: segment };
  const current = parseSearchParams(options.view);
  const naming = ref<BookmarkNamePopupOptions['target'] | null>(null);

  const list = useResource<BookmarkList>('GET /dashboard/bookmarks/[collection]', { params });
  const update = useAction('PATCH /dashboard/bookmarks/[collection]/[uuid]', {
    params,
    reload: [list],
  });
  const remove = useAction('DELETE /dashboard/bookmarks/[collection]/[uuid]', {
    params,
    reload: [list],
  });
  const choose = useAction('PUT /dashboard/bookmarks/[collection]/default', {
    params,
    reload: [list],
  });

  const done = (message: string): void => {
    toast(message, { type: 'success' });
  };

  const applied = (view: string): boolean => deepEqual(parseSearchParams(view), current);

  const apply = (view: string): void => {
    options.onApply(view);
    options.onClose(handle.close);
  };

  const setDefault = async (bookmark: BookmarkEntry | null): Promise<void> => {
    const UUID = bookmark?.UUID ?? null;
    if (list()?.default === UUID || !(await choose.run({ body: { bookmark: UUID } }))) return;
    done(
      isNull(bookmark)
        ? t('dashboard.bookmarks.opensWithDefaults')
        : t('dashboard.bookmarks.opensWith', { name: bookmark.name }),
    );
  };

  const change = async (
    bookmark: BookmarkEntry,
    body: Partial<BookmarkEntry>,
    message: 'viewUpdated' | 'nowShared' | 'noLongerShared',
  ): Promise<void> => {
    if (await update.run({ params: { uuid: bookmark.UUID }, body })) {
      done(t(`dashboard.bookmarks.${message}`, { name: bookmark.name }));
    }
  };

  const confirmDelete = async (bookmark: BookmarkEntry): Promise<void> => {
    const action = await openDialog({
      content: t('dashboard.bookmarks.confirmDelete', { name: bookmark.name }),
      actions: [
        { name: 'cancel', label: t('dashboard.cancel') },
        { name: 'delete', label: t('dashboard.delete'), variant: 'destructive' },
      ],
    });
    if (action === 'delete' && (await remove.run({ params: { uuid: bookmark.UUID } }))) {
      done(t('dashboard.bookmarks.deleted', { name: bookmark.name }));
    }
  };

  const ownActions = (bookmark: BookmarkEntry): MenuItem[] => {
    const editable = canUpdate && (!bookmark.shared || canShare);
    const items: MenuItem[] = [];
    if (editable && !applied(bookmark.view)) {
      items.push({
        label: 'dashboard.bookmarks.update',
        icon: 'device-floppy',
        onSelect: () => void change(bookmark, { view: options.view }, 'viewUpdated'),
      });
    }
    items.push('---');
    if (canShare && !bookmark.shared) {
      items.push({
        label: 'dashboard.bookmarks.share',
        icon: 'users-plus',
        onSelect: () => void change(bookmark, { shared: true }, 'nowShared'),
      });
    }
    if (canUpdate && bookmark.shared) {
      items.push({
        label: 'dashboard.bookmarks.stopSharing',
        icon: 'users-minus',
        onSelect: () => void change(bookmark, { shared: false }, 'noLongerShared'),
      });
    }
    if (editable) {
      items.push({
        label: 'dashboard.bookmarks.rename',
        icon: 'pencil',
        onSelect: () => {
          naming.value = { bookmark };
        },
      });
    }
    if (canDelete) {
      items.push({
        label: 'dashboard.delete',
        icon: 'trash-x',
        destructive: true,
        onSelect: () => void confirmDelete(bookmark),
      });
    }
    return items;
  };

  /**
   * A small icon button that turns accent while `active` holds, its tooltip following.
   */
  const markButton = (
    glyph: IconName,
    active: () => boolean,
    label: () => string,
    onClick: () => void,
  ): HTMLElement => {
    const el = button(label, {
      icon: glyph,
      iconOnly: true,
      size: -3,
      variant: 'outline',
      onClick,
    });
    effect(() => {
      const on = active();
      el.classList.toggle('ohne-button-accent', on);
      el.classList.toggle('ohne-button-outline', !on);
    });
    return el;
  };

  const applyButton = (view: () => string): HTMLElement =>
    markButton(
      'check',
      () => applied(view()),
      () => t(applied(view()) ? 'dashboard.bookmarks.applied' : 'dashboard.apply'),
      () => apply(view()),
    );

  const defaultButton = (
    value: () => BookmarkList,
    bookmark: () => BookmarkEntry | null,
  ): Child => {
    if (!canDefault) return null;
    const chosen = (): boolean => value().default === (bookmark()?.UUID ?? null);
    return markButton(
      'star',
      chosen,
      () => t(chosen() ? 'dashboard.bookmarks.isDefault' : 'dashboard.bookmarks.setDefault'),
      () => void setDefault(bookmark()),
    );
  };

  const section = (label: () => string, ...content: Child[]): HTMLElement =>
    h(
      'div',
      { class: 'ohne-field' },
      fieldLabel(h('span', { class: 'ohne-label ohne-muted' }, label)),
      ...content,
    );

  const stack = (rows: Child): HTMLElement => h('div', { class: 'o-bookmarks-list' }, rows);

  const row = (...content: Child[]): HTMLElement =>
    card(h('div', { class: 'ohne-row' }, ...content));

  const ownRow = (value: () => BookmarkList, item: () => BookmarkEntry): HTMLElement =>
    row(
      h(
        'span',
        { class: 'ohne-row ohne-mr-auto' },
        h('span', { class: 'ohne-truncate' }, () => item().name),
        when(
          () => item().shared,
          () =>
            h(
              'span',
              { class: 'ohne-muted ohne-shrink-0' },
              () => `(${t('dashboard.bookmarks.sharedNote')})`,
            ),
        ),
      ),
      applyButton(() => item().view),
      defaultButton(value, item),
      when(
        () => ownActions(item()).some((action) => action !== '---'),
        () =>
          menu(
            button(() => t('dashboard.record.moreActions'), {
              icon: 'dots-vertical',
              iconOnly: true,
              size: -3,
              variant: 'outline',
            }),
            () => ownActions(item()),
          ),
      ),
    );

  const sharedRow = (value: () => BookmarkList, item: () => BookmarkEntry): HTMLElement =>
    row(
      h('span', { class: 'ohne-mr-auto ohne-truncate' }, () => item().name),
      applyButton(() => item().view),
      defaultButton(value, item),
    );

  const sections = (value: () => BookmarkList): HTMLElement => {
    const mine = computed(() => value().bookmarks.filter((bookmark) => bookmark.mine));
    const others = computed(() => value().bookmarks.filter((bookmark) => !bookmark.mine));
    return h(
      'div',
      { class: 'o-bookmarks' },
      section(
        () => t('dashboard.bookmarks.predefined'),
        stack(
          row(
            h('span', { class: 'ohne-mr-auto ohne-truncate' }, () =>
              t('dashboard.bookmarks.defaultSettings'),
            ),
            applyButton(() => ''),
            defaultButton(value, () => null),
          ),
        ),
      ),
      when(
        () => canCreate || !isEmpty(mine.value),
        () =>
          section(
            () => t('dashboard.bookmarks.myBookmarks'),
            when(
              () => !isEmpty(mine.value),
              () =>
                stack(
                  each(
                    () => mine.value,
                    (bookmark) => bookmark.UUID,
                    (item) => ownRow(value, item),
                  ),
                ),
            ),
            canCreate
              ? button([icon('plus'), h('span', null, () => t('dashboard.bookmarks.add'))], {
                  variant: 'outline',
                  onClick: () => {
                    naming.value = { view: options.view };
                  },
                })
              : null,
          ),
      ),
      when(
        () => !isEmpty(others.value),
        () =>
          section(
            () => t('dashboard.bookmarks.sharedBookmarks'),
            stack(
              each(
                () => others.value,
                (bookmark) => bookmark.UUID,
                (item) => sharedRow(value, item),
              ),
            ),
          ),
      ),
    );
  };

  const nameHost = when(
    () => !isNull(naming.value),
    () => {
      const target = naming.value;
      if (isNull(target)) return null;
      bookmarkNamePopup({
        segment,
        target,
        list,
        onClose: (close) =>
          void close().then(() => {
            naming.value = null;
          }),
      });
      return null;
    },
  );

  const closeButton = button(() => t('dashboard.close'), {
    icon: 'x',
    iconOnly: true,
    size: -2,
    variant: 'ghost',
    class: 'ohne-ml-auto',
    onClick: () => options.onClose(handle.close),
  });

  const handle = popup(h('div', { class: 'o-bookmarks-body' }, loaded(list, sections), nameHost), {
    size: -1,
    fullHeight: 'auto',
    header: h(
      'div',
      { class: 'ohne-row' },
      h('span', { class: 'o-bookmarks-title' }, () => t('dashboard.bookmarks.title')),
      closeButton,
    ),
    onClose: () => options.onClose(handle.close),
  });

  return handle;
}
