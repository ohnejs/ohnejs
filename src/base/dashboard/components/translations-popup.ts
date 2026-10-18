import {
  api,
  attachTooltip,
  button,
  type Child,
  css,
  type DashboardCollection,
  dashboardMeta,
  h,
  icon,
  loadVerdicts,
  navigate,
  openDialog,
  popup,
  type Popup,
  type RowVerdicts,
  toast,
  useAction,
  useT,
  when,
} from 'ohnejs/dashboard';
import {
  displayName,
  formatLocaleCode,
  isUndefined,
  onCleanup,
  recordHref,
  isPlainObject,
  ref,
  stripCodeSpans,
  untracked,
} from 'ohnejs/utils';

import {
  activeContentLocale,
  contentLocale,
  effectiveContentLocale,
} from './content-language-switcher.ts';

/**
 * Options for `translationsPopup`.
 */
export interface TranslationsPopupOptions {
  /**
   * The translatable collection the record belongs to.
   */
  collection: DashboardCollection;

  /**
   * The record's `UUID`.
   */
  uuid: string;

  /**
   * The label marking the current content locale's row.
   * Omitted renders the "currently editing" message.
   */
  currentlyEditing?: () => string;

  /**
   * Whether the current content locale's row keeps its action buttons beside the marker.
   *
   * @default
   * false
   */
  showEditCurrent?: boolean;

  /**
   * Called after a locale's translation deletes, with the deleted locale.
   * A view showing the record's values refreshes here, since the deleted locale's values are gone.
   */
  onDeleted?(locale: string): void;

  /**
   * Called after a locale's translation copies in, with the target locale.
   * A view showing the record's held locales refreshes here, since the target now holds one.
   */
  onCopied?(locale: string): void;

  /**
   * Called when the popup asks to close, with its animated close function.
   * The caller awaits it and then disposes the region that created the popup.
   */
  onClose(close: () => Promise<void>): void;
}

css`
  .o-translations-title {
    font-weight: 500;
  }

  .o-translations-locale {
    min-width: 0;
  }

  .o-translations hr {
    width: calc(100% + 1.5rem);
    margin: 0.75rem -0.75rem;
  }

  .o-translations .ohne-button-disabled {
    opacity: 0.24;
  }
`;

/**
 * The record translations popup.
 *
 * One row per configured locale: the formatted code, its display name, and the locale's actions.
 * The current content locale carries a marker, and its actions only with `showEditCurrent`.
 * New and Edit close the popup, route to the record when elsewhere, and switch the content locale.
 * Copy projects the current locale's translatable values onto the target locale, staying open.
 * Delete confirms first, then removes the locale's translation whole, staying open too.
 * Each action follows the record's verdicts at its row's locale, and Copy at the current locale as well.
 * The actions render once the translated locales and the verdicts are read; a failed read toasts and closes.
 * Create it inside a reactive region; dispose the region after `onClose`'s close resolves.
 */
export function translationsPopup(options: TranslationsPopupOptions): Popup {
  const t = useT();
  const { collection, uuid } = options;
  const showEditCurrent = options.showEditCurrent ?? false;
  const existing = ref<string[] | undefined>(undefined);
  const verdicts = ref<ReadonlyMap<string, RowVerdicts> | undefined>(undefined);
  const route = { collection: collection.segment, uuid };
  const copyAction = useAction('POST /collections/[collection]/[uuid]/translations/copy', {
    params: route,
    onError: (error) => {
      const errors = isPlainObject(error.data) ? error.data.errors : undefined;
      if (error.status !== 422 || !isPlainObject(errors)) {
        toast(t('dashboard.translations.copyFailed'), { type: 'error' });
        return;
      }
      toast(t('dashboard.foundErrors', { count: Object.keys(errors).length }), {
        type: 'error',
        description: Object.entries(errors)
          .map(([path, message]) => `\`${path}\`: ${String(message)}`)
          .join('\n'),
      });
    },
  });
  const deleteAction = useAction('DELETE /collections/[collection]/[uuid]/translations', {
    params: route,
    onError: () => toast(t('dashboard.translations.deleteFailed'), { type: 'error' }),
  });

  const refresh = async (): Promise<boolean> => {
    const locales = untracked(dashboardMeta)?.locales ?? [];
    try {
      const [response, answered] = await Promise.all([
        api(`GET /collections/${collection.segment}/${uuid}/translations`),
        Promise.all(
          locales.map(
            async (code) => [code, await loadVerdicts(collection, [uuid], code)] as const,
          ),
        ),
      ]);
      if (!response.ok) return false;
      const answer = (await response.json()) as { locales?: string[] };
      verdicts.value = new Map(answered);
      existing.value = answer.locales ?? [];
      return true;
    } catch {
      return false;
    }
  };

  const admits = (operation: 'update' | 'deleteTranslation', code: string): boolean =>
    verdicts.value?.get(code)?.[operation].has(uuid) === true;

  void refresh().then((loaded) => {
    if (!loaded) {
      toast(t('dashboard.unreachable'), { type: 'error' });
      options.onClose(handle.close);
    }
  });

  const closeThen = (after: () => void): void => {
    options.onClose(() => handle.close().then(after));
  };

  const activate = (code: string): void => {
    closeThen(() => {
      const target = recordHref(collection, uuid);
      if (location.pathname + location.search !== target) navigate(target);
      if (code !== effectiveContentLocale()) contentLocale.value = code;
    });
  };

  const copy = async (code: string): Promise<void> => {
    if (copyAction.busy()) return;
    const source = activeContentLocale();
    const copied = await copyAction.run({
      query: { locale: code },
      body: isUndefined(source) ? {} : { source },
    });
    if (!copied) return;
    toast(t('dashboard.translations.copied'), { type: 'success' });
    void refresh();
    options.onCopied?.(code);
  };

  const remove = async (code: string): Promise<void> => {
    if (deleteAction.busy()) return;
    const action = await openDialog({
      content: t('dashboard.translations.confirmDelete', { locale: formatLocaleCode(code) }),
      actions: [
        { name: 'cancel', label: t('dashboard.cancel') },
        { name: 'delete', label: t('dashboard.delete'), variant: 'destructive' },
      ],
    });
    if (action !== 'delete') return;
    if (await deleteAction.run({ query: { locale: code } })) {
      toast(t('dashboard.translations.deleted'), { type: 'success' });
      options.onDeleted?.(code);
    }
    void refresh();
  };

  const actions = (code: string): Child[] => {
    const current = effectiveContentLocale();
    const translated = existing.value ?? [];
    const canWrite = admits('update', code);
    const items: Child[] = [];
    if (code === current && !showEditCurrent) return items;

    if (!translated.includes(code)) {
      const label = (): string => t('dashboard.translations.new');
      const newButton = button(label, {
        icon: 'note',
        iconOnly: true,
        size: -2,
        variant: canWrite ? 'primary' : 'ghost',
        disabled: canWrite ? undefined : () => true,
        onClick: () => activate(code),
      });
      items.push(newButton);
    } else {
      const label = (): string =>
        t(canWrite ? 'dashboard.translations.edit' : 'dashboard.translations.view');
      const editButton = button(label, {
        icon: canWrite ? 'pencil' : 'list-search',
        iconOnly: true,
        size: -2,
        variant: canWrite ? 'outline' : 'ghost',
        onClick: () => activate(code),
      });
      items.push(editButton);
    }

    const copyOff =
      !canWrite ||
      !admits('update', current) ||
      copyAction.busy() ||
      !translated.includes(current) ||
      code === current;
    const copyLabel = (): string =>
      t('dashboard.translations.copy', {
        from: formatLocaleCode(current),
        to: formatLocaleCode(code),
      });
    const copyButton = button(icon('file-import'), {
      size: -2,
      variant: copyOff ? 'ghost' : 'outline',
      disabled: copyOff ? () => true : undefined,
      ariaLabel: stripCodeSpans(copyLabel()),
      onClick: () => void copy(code),
    });
    // Copying onto itself is no action, so the self row's disabled copy explains nothing.
    if (code !== current) onCleanup(attachTooltip(copyButton, copyLabel));
    items.push(copyButton);

    if (admits('deleteTranslation', code)) {
      const deleteOff = deleteAction.busy() || !translated.includes(code);
      const deleteLabel = (): string =>
        t('dashboard.translations.delete', { locale: formatLocaleCode(code) });
      const deleteButton = button(deleteLabel, {
        icon: 'trash-x',
        iconOnly: true,
        size: -2,
        variant: deleteOff ? 'ghost' : 'outline',
        destructiveHover: !deleteOff,
        disabled: deleteOff ? (): boolean => true : undefined,
        ariaLabel: () => stripCodeSpans(deleteLabel()),
        onClick: () => void remove(code),
      });
      items.push(deleteButton);
    }

    return items;
  };

  const rows = (): Child[] => {
    const current = effectiveContentLocale();
    return (dashboardMeta()?.locales ?? []).flatMap((code, index): Child[] => [
      index > 0 ? h('hr') : null,
      h(
        'div',
        { class: 'ohne-justify-between' },
        h(
          'div',
          { class: 'ohne-row o-translations-locale' },
          h('div', { class: 'ohne-shrink-0' }, formatLocaleCode(code)),
          h(
            'span',
            { class: 'ohne-muted ohne-truncate' },
            `(${displayName(code, 'language', code)})`,
          ),
          code === current
            ? h(
                'span',
                { class: 'ohne-row ohne-muted ohne-truncate' },
                h('span', null, '-'),
                h(
                  'span',
                  { class: 'ohne-truncate' },
                  options.currentlyEditing?.() ?? t('dashboard.translations.currentlyEditing'),
                ),
              )
            : null,
        ),
        h(
          'div',
          { class: 'ohne-row ohne-shrink-0' },
          when(
            () => !isUndefined(existing.value) && !isUndefined(verdicts.value),
            () => () => actions(code),
          ),
        ),
      ),
    ]);
  };

  const closeButton = button(() => t('dashboard.close'), {
    icon: 'x',
    iconOnly: true,
    size: -2,
    variant: 'ghost',
    class: 'ohne-ml-auto',
    onClick: () => options.onClose(handle.close),
  });

  const handle = popup(h('div', { class: 'o-translations' }, rows), {
    size: -1,
    header: h(
      'div',
      { class: 'ohne-row' },
      h('span', { class: 'o-translations-title' }, () => t('dashboard.translations.title')),
      closeButton,
    ),
    onClose: () => options.onClose(handle.close),
  });

  return handle;
}
