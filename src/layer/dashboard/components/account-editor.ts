import {
  api,
  attachTooltip,
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
  setDocumentTitle,
  setNavigationGuard,
  toast,
  updateSessionUser,
  useDashboardLanguage,
  useHotkeys,
  useT,
  when,
} from 'ohnejs/dashboard';
import { effect, isEmpty, isNullish, isUndefined, onCleanup, ref, untracked } from 'ohnejs/utils';

import { contentLocale } from './content-language-switcher.ts';
import { historyButtons } from './history-buttons.ts';
import { historyScrollState } from './history-scroll-state.ts';
import { History, unsavedChanges } from './history.ts';

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
 * Every edit debounce-pushes onto a `History`; undo and redo rebuild the form from the restored state.
 * Leaving dirty edits routes through the `unsavedChanges` prompt, in-app and on tab close.
 * Cmd/Ctrl+S saves while no overlay is open.
 * Save patches the dirty fields through `updateSessionUser`; a `422` routes onto the rows it names.
 * A saved language change resets the discovery data, so the form rebuilds on labels in the new language.
 * The history and the guard live outside that rebuild, so the rebuilt form starts clean.
 */
export function accountEditor(): Child {
  const t = useT();
  effect(() => setDocumentTitle(t('dashboard.account.title')));

  const history = new History();
  const form = ref<FieldForm | undefined>(undefined);
  const busy = ref(false);

  const stateOf = (live: FieldForm): AccountState | undefined => {
    const reading = live.read();
    return isUndefined(reading.errors) ? ((reading.value ?? {}) as AccountState) : undefined;
  };
  const currentState = (): AccountState | undefined =>
    isUndefined(form.value) ? undefined : stateOf(form.value);

  // The in-app leg of the leave guard: `unsavedChanges` owns the dialog and the tab-close leg.
  setNavigationGuard((target) => {
    if (!history.isDirty.value || isUndefined(unsavedChanges.prompt)) {
      unsavedChanges.history = null;
      return true;
    }
    void unsavedChanges.prompt().then((leave) => {
      if (leave) {
        setNavigationGuard(null);
        navigate(target);
      }
    });
    return false;
  });
  onCleanup(() => setNavigationGuard(null));

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
    if (isEmpty(patch)) return;
    const focused = document.activeElement;
    const localeBefore = sessionUser()?.contentLanguage ?? null;
    // Read before the write: a language change swaps the catalog, and a toast holds a static string.
    const savedLabel = t('dashboard.saved');
    busy.value = true;
    const outcome = await updateSessionUser(patch);
    busy.value = false;
    // The saving fieldset blurs whatever was focused; the element survives the save, so restore.
    if (focused instanceof HTMLElement && focused.isConnected) focused.focus();
    if (outcome.kind === 'saved') {
      // A language change has already torn `live` down; its controls still answer the settled state.
      live.rebase({ ...outcome.user });
      const settled = stateOf(live);
      if (!isUndefined(settled)) history.push(settled).setOriginalState(settled);
      if (outcome.user.contentLanguage !== localeBefore) {
        contentLocale.value = outcome.user.contentLanguage ?? undefined;
      }
      toast(savedLabel, { type: 'success' });
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
   * A saved language change does exactly that, by resetting the discovery data.
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

    const buildForm = (initial: AccountState): FieldForm =>
      createFieldForm(meta.accountFields, initial, {
        mode: 'edit',
        path: '',
        readOnlyRows: true,
        language: () => useDashboardLanguage().value,
        onInput: () => {
          const state = currentState();
          if (!isUndefined(state)) void history.pushDebounced(state);
        },
      });

    form.value = buildForm({ ...user });
    onCleanup(() => {
      form.value?.dispose();
      form.value = undefined;
    });
    // Untracked: a tracked seed read would subscribe the whole region to the first keystroke.
    history.push(untracked(currentState) ?? {});

    const restore = (restored: AccountState): void => {
      form.value?.dispose();
      form.value = buildForm(restored);
    };

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
      h('fieldset', { class: 'o-account-fields', disabled: () => busy.value }, () =>
        form.value?.render(),
      ),
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

    const signOutButton = button(icon('plug-connected-x'), {
      variant: 'outline',
      onClick: () => void signOutOthers(),
    });
    onCleanup(attachTooltip(signOutButton, () => t('dashboard.account.signOutOtherDevices')));

    // Save takes no disabled state: `save` guards re-entry, and a static variant keeps the toggles below.
    const saveButton = button([h('span', null, () => t('dashboard.save')), icon('device-floppy')], {
      variant: 'outline',
      onClick: () => void save(),
    });
    effect(() => {
      const dirty = history.isDirty.value;
      saveButton.classList.toggle('ohne-button-primary', dirty);
      saveButton.classList.toggle('ohne-button-outline', !dirty);
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
