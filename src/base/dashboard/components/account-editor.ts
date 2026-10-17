import {
  api,
  button,
  type Child,
  container,
  createFieldForm,
  css,
  dashboardMeta,
  type FieldForm,
  h,
  icon,
  navigate,
  openDialog,
  overlayCount,
  queueToast,
  sessionUser,
  toast,
  updateSessionUser,
  useDashboardLanguage,
  useDocumentTitle,
  useHotkeys,
  useT,
  useUnsavedChanges,
  when,
} from 'ohnejs/dashboard';
import { effect, isEmpty, isNullish, isUndefined, onCleanup, ref, untracked } from 'ohnejs/utils';

import { contentLocale } from './content-language-switcher.ts';
import { historyButtons } from './history-buttons.ts';
import { historyScrollState } from './history-scroll-state.ts';
import { History } from './history.ts';

/**
 * The account form's values, as the form reads them.
 */
type AccountState = Record<string, unknown>;

css`
  .o-account-editor {
    display: flex;
    flex-direction: column;
    height: 100%;
  }

  .o-account-header {
    padding: calc(0.75rem + 1px) 0.75rem 0.75rem;
    border-bottom-width: 1px;
    font-size: 0.875rem;
    font-weight: 500;
  }

  .o-account-main {
    container-type: inline-size;
    contain: layout;
    padding: 0.75rem;
  }

  .o-account-footer {
    border-top-width: 1px;
    padding: 0.75rem;
  }

  .o-account-fields {
    border: 0;
    margin: 0;
    padding: 0;
    min-inline-size: auto;
  }
`;

/**
 * The signed-in user's own settings surface, at `/account`.
 *
 * The discovery data lists the fields; an empty list redirects to the overview with a toast.
 * A keystroke debounce-pushes onto a `History` and a discrete change pushes at once.
 * Undo and redo patch the form in place from the restored state.
 * Leaving dirty edits asks first, in-app and on tab close, while the history or the form reads dirty.
 * Cmd/Ctrl+S saves while no overlay is open.
 * Save patches the dirty fields through `updateSessionUser`; a `422` routes onto the rows it names.
 * A saved language change keeps the form: its labels follow the language in place.
 */
export function accountEditor(): Child {
  const t = useT();
  useDocumentTitle('dashboard.account.title');

  const history = new History({ watchUnsavedChanges: false });
  const form = ref<FieldForm | undefined>(undefined);
  const busy = ref(false);

  // The form reads dirty before its typing lands in the history, so the guard asks on either.
  const dirty = (): boolean => history.isDirty.value || form.value?.dirty() === true;
  useUnsavedChanges(dirty);

  const settle = (live: FieldForm): void => {
    const settled = live.draft(history.getCurrentState());
    history.push(settled).setOriginalState(settled);
  };

  const save = async (): Promise<void> => {
    const live = form.value;
    if (isUndefined(live) || busy.value) return;
    const reading = live.readPatch();
    if (!isUndefined(reading.errors)) {
      live.setErrors(reading.errors);
      live.focusError();
      return;
    }
    const patch = (reading.value ?? {}) as AccountState;
    // A draft that writes the stored value, like a case-only address edit, is saved by settling.
    if (isEmpty(patch)) {
      settle(live);
      return;
    }
    const focused = document.activeElement;
    const localeBefore = sessionUser()?.contentLanguage ?? null;
    busy.value = true;
    const outcome = await updateSessionUser(patch);
    busy.value = false;
    // The saving fieldset blurs whatever was focused; the element survives the save, so restore.
    if (focused instanceof HTMLElement && focused.isConnected) focused.focus();
    if (outcome.kind === 'saved') {
      live.rebase({ ...outcome.user });
      settle(live);
      if (outcome.user.contentLanguage !== localeBefore) {
        contentLocale.value = outcome.user.contentLanguage ?? undefined;
      }
      toast(t('dashboard.saved'), { type: 'success' });
      return;
    }
    if (outcome.kind === 'invalid') {
      live.setErrors(outcome.errors);
      live.focusError();
      toast(t('dashboard.foundErrors', { count: Object.keys(outcome.errors).length }), {
        type: 'error',
      });
      return;
    }
    toast(t(outcome.kind === 'unreachable' ? 'dashboard.unreachable' : 'dashboard.writeFailed'), {
      type: 'error',
    });
  };

  const signOutOthers = async (): Promise<void> => {
    const action = await openDialog({
      content: t('dashboard.account.confirmSignOutOtherDevices'),
      actions: [
        { name: 'cancel', label: t('dashboard.cancel') },
        { name: 'sign-out', label: t('dashboard.signOut'), variant: 'primary' },
      ],
    });
    if (action !== 'sign-out') return;
    const ok = await logoutOthers();
    toast(t(ok ? 'dashboard.account.signedOut' : 'dashboard.unreachable'), {
      type: ok ? 'success' : 'error',
    });
  };

  const { listen } = useHotkeys();
  listen('save', (event) => {
    if (overlayCount() > 0) return;
    event.preventDefault();
    const active = document.activeElement;
    if (active instanceof HTMLElement) active.blur();
    setTimeout(() => void save());
  });

  return when(
    () => !isUndefined(dashboardMeta()) && !isNullish(sessionUser()),
    () => editor(),
  );

  /**
   * The editor proper, built once the discovery data and the session both stand.
   * Its reads run untracked, so the region rebuilds only when the data vanishes and returns.
   */
  function editor(): Child {
    const meta = untracked(dashboardMeta);
    const user = untracked(sessionUser);
    if (isUndefined(meta) || isNullish(user)) return null;
    if (isEmpty(meta.accountFields)) {
      queueToast(t('dashboard.redirected'), {
        type: 'error',
        description: t('dashboard.account.noAccess', { page: '/account' }),
        showAfterRouteChange: true,
      });
      navigate('/overview');
      return null;
    }

    const live = createFieldForm(
      meta.accountFields,
      { ...user },
      {
        mode: 'edit',
        path: '',
        readOnlyRows: true,
        layout: meta.accountLayout,
        language: () => useDashboardLanguage().value,
        onInput: (discrete) => {
          const state = live.draft(history.getCurrentState());
          if (discrete === true) history.flush().push(state);
          else void history.pushDebounced(state);
        },
      },
    );
    form.value = live;
    onCleanup(() => {
      live.dispose();
      form.value = undefined;
    });
    // Untracked: a tracked seed read would subscribe the whole region to the first keystroke.
    history.push(untracked(() => live.draft()));

    // A state holds the form's fields; the session user still holds the read-only rows' values.
    const restore = (restored: AccountState): void =>
      live.restore({ ...untracked(sessionUser), ...restored });

    const headerEl = h(
      'div',
      { class: 'o-account-header' },
      h(
        'div',
        { class: 'ohne-row' },
        h('span', { class: 'ohne-shrink-0' }, () => t('dashboard.account.title')),
        h(
          'span',
          { class: 'ohne-truncate ohne-muted', title: () => sessionUser()?.email },
          () => `(${sessionUser()?.email ?? ''})`,
        ),
      ),
    );

    const mainEl = h(
      'div',
      { class: 'o-account-main' },
      h('fieldset', { class: 'o-account-fields', disabled: () => busy.value }, () => live.render()),
    );

    const containerEl = container([headerEl, mainEl]);
    containerEl.classList.add('ohne-flex-1');

    const scrollY = ref(0);
    containerEl.addEventListener(
      'scroll',
      () => {
        scrollY.value = containerEl.scrollTop;
      },
      { passive: true },
    );
    historyScrollState({
      y: () => scrollY.value,
      setY: (value) => {
        containerEl.scrollTop = value;
        scrollY.value = value;
      },
    });

    const signOutButton = button(() => t('dashboard.account.signOutOtherDevices'), {
      icon: 'plug-connected-x',
      iconOnly: true,
      variant: 'outline',
      onClick: () => void signOutOthers(),
    });

    // Save takes no disabled state: `save` guards re-entry, and a static variant keeps the toggles below.
    const saveButton = button([h('span', null, () => t('dashboard.save')), icon('device-floppy')], {
      variant: 'outline',
      onClick: () => void save(),
    });
    effect(() => {
      const unsaved = dirty();
      saveButton.classList.toggle('ohne-button-primary', unsaved);
      saveButton.classList.toggle('ohne-button-outline', !unsaved);
    });

    const footerEl = h(
      'div',
      { class: 'o-account-footer' },
      h(
        'div',
        { class: 'ohne-justify-between ohne-w-full' },
        historyButtons(history, restore),
        h('div', { class: 'ohne-row ohne-ml-auto' }, signOutButton, saveButton),
      ),
    );

    return h('div', { class: 'o-account-editor' }, containerEl, footerEl);
  }
}

/**
 * Posts the sign-out of every other session; answers whether the server confirmed it.
 */
async function logoutOthers(): Promise<boolean> {
  try {
    return (await api('POST /auth/logout/others')).ok;
  } catch {
    return false;
  }
}
