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
  navigate,
  popup,
  type Popup,
  toast,
  useT,
  when,
} from 'ohne/dashboard';
import {
  effect,
  formatLocaleCode,
  isUndefined,
  onCleanup,
  ref,
  sleep,
  stringifySearchParams,
} from 'ohne/utils';

import {
  activeContentLocale,
  contentLocale,
  effectiveContentLocale,
  localeName,
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
   * Called when the popup asks to close, with its animated close function.
   * The caller awaits it and then disposes the region that created the popup.
   */
  onClose(close: () => Promise<void>): void;
}

type CopyOutcome =
  | { kind: 'saved' }
  | { kind: 'invalid'; errors: Readonly<Record<string, string>> }
  | { kind: 'failed' };

css`
  .o-translations-title {
    font-weight: 500;
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
 * The current content locale carries a marker instead of an edit button, unless `showEditCurrent`.
 * New and Edit close the popup, route to the record when elsewhere, and switch the content locale.
 * Copy projects the current locale's translatable values onto the target locale, staying open.
 * The actions render once the record's translated locales are read; a failed read toasts and closes.
 * Create it inside a reactive region; dispose the region after `onClose`'s close resolves.
 */
export function translationsPopup(options: TranslationsPopupOptions): Popup {
  const t = useT();
  const { collection, uuid } = options;
  const showEditCurrent = options.showEditCurrent ?? false;
  const canWrite = collection.operations.update?.allowed === true;
  const existing = ref<string[] | undefined>(undefined);
  const copying = ref(false);

  const fetchExisting = async (): Promise<boolean> => {
    try {
      const response = await api(`GET /collections/${collection.segment}/${uuid}/translations`);
      if (!response.ok) return false;
      const answer = (await response.json()) as { locales?: string[] };
      existing.value = answer.locales ?? [];
      return true;
    } catch {
      return false;
    }
  };

  void fetchExisting().then((loaded) => {
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
      const target = `/collections/${collection.segment}/${uuid}`;
      if (location.pathname !== target) navigate(target);
      if (code !== effectiveContentLocale()) contentLocale.value = code;
    });
  };

  const copy = async (code: string): Promise<void> => {
    if (copying.value) return;
    copying.value = true;
    const outcome = await requestCopy(collection.segment, uuid, code);
    copying.value = false;
    if (outcome.kind === 'saved') {
      toast(t('dashboard.translations.copied'), { type: 'success' });
      void fetchExisting();
      return;
    }
    if (outcome.kind === 'invalid') {
      toast(t('dashboard.foundErrors', { count: Object.keys(outcome.errors).length }), {
        type: 'error',
        description: Object.entries(outcome.errors)
          .map(([path, message]) => `\`${path}\`: ${message}`)
          .join('\n'),
      });
      return;
    }
    toast(t('dashboard.translations.copyFailed'), { type: 'error' });
  };

  const actions = (code: string): Child[] => {
    const current = effectiveContentLocale();
    const translated = existing.value ?? [];
    const items: Child[] = [];
    if (code === current && !showEditCurrent) return items;

    if (!translated.includes(code)) {
      const newButton = button(icon('note'), {
        size: -2,
        variant: canWrite ? 'primary' : 'ghost',
        disabled: canWrite ? undefined : () => true,
        onClick: () => activate(code),
      });
      onCleanup(attachTooltip(newButton, () => t('dashboard.translations.new')));
      items.push(newButton);
    } else {
      const editButton = button(icon(canWrite ? 'pencil' : 'list-search'), {
        size: -2,
        variant: canWrite ? 'outline' : 'ghost',
        onClick: () => activate(code),
      });
      onCleanup(
        attachTooltip(editButton, () =>
          t(canWrite ? 'dashboard.translations.edit' : 'dashboard.translations.view'),
        ),
      );
      items.push(editButton);
    }

    const copyOff = !canWrite || copying.value || !translated.includes(current);
    const copyButton = button(icon('file-import'), {
      size: -2,
      variant: copyOff ? 'ghost' : 'outline',
      disabled: copyOff ? () => true : undefined,
      class: code === current ? 'ohne-invisible' : undefined,
      onClick: () => void copy(code),
    });
    onCleanup(
      attachTooltip(copyButton, () =>
        t('dashboard.translations.copy', {
          from: formatLocaleCode(current),
          to: formatLocaleCode(code),
        }),
      ),
    );
    items.push(copyButton);

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
          { class: 'ohne-row' },
          h('div', { class: 'ohne-shrink-0' }, formatLocaleCode(code)),
          h('span', { class: 'ohne-muted ohne-truncate' }, `(${localeName(code)})`),
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
          { class: 'ohne-row' },
          when(
            () => !isUndefined(existing.value),
            () => actions(code),
          ),
        ),
      ),
    ]);
  };

  const closeButton = button(icon('x'), {
    size: -2,
    variant: 'ghost',
    class: 'ohne-ml-auto',
    onClick: () => options.onClose(handle.close),
  });
  effect(() => {
    closeButton.title = t('dashboard.close');
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

/**
 * Requests the server-side copy of the active locale's translation into `locale`.
 * The source rides the body; absent, the server copies from the default locale.
 * Retries once on a busy `503`.
 */
async function requestCopy(segment: string, uuid: string, locale: string): Promise<CopyOutcome> {
  const source = activeContentLocale();
  const send = (): Promise<Response> =>
    api(
      `POST /collections/${segment}/${uuid}/translations/copy?${stringifySearchParams({ locale })}`,
      {
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(isUndefined(source) ? {} : { source }),
      },
    );
  try {
    let response = await send();
    if (response.status === 503) {
      await sleep(1000);
      response = await send();
    }
    if (response.ok) return { kind: 'saved' };
    if (response.status === 422) {
      const answer = (await response.json()) as { data?: { errors?: Record<string, string> } };
      const errors = Object.create(null) as Record<string, string>;
      Object.assign(errors, answer.data?.errors ?? {});
      return { kind: 'invalid', errors };
    }
    return { kind: 'failed' };
  } catch {
    return { kind: 'failed' };
  }
}
