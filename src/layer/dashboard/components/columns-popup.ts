import {
  button,
  css,
  type DashboardField,
  h,
  icon,
  popup,
  type Popup,
  useHotkeys,
  useT,
  when,
} from 'ohne/dashboard';
import { computed, deepEqual, effect, ref } from 'ohne/utils';

import { unsavedChanges } from './history.ts';
import { tableColumnsConfigurator } from './table-columns-configurator.ts';

/**
 * Options for `columnsPopup`.
 */
export interface ColumnsPopupOptions {
  /**
   * The column field candidates, read reactively.
   */
  fields: () => DashboardField[];

  /**
   * The current column entries, one `name|width|minWidth` string per column.
   */
  current: readonly string[];

  /**
   * The default column entries the restore button returns to.
   */
  defaults: readonly string[];

  /**
   * Called with the edited entries on Apply, or `undefined` when they equal the defaults.
   */
  onApply(columns: string[] | undefined): void;

  /**
   * Called when the popup asks to close, with its animated close function.
   * The caller awaits it and then disposes the region that created the popup.
   */
  onClose(close: () => Promise<void>): void;
}

css`
  .o-columns-popup-title {
    font-weight: 500;
  }
`;

/**
 * The table columns popup: the `tableColumnsConfigurator` inside the apply-or-discard shell.
 * A dirty edit guards Escape and the overlay click through the `unsavedChanges` prompt.
 * A restore button reverts to the defaults; Apply hands `undefined` when the edit equals them.
 * Create it inside a reactive region; dispose the region after `onClose`'s close resolves.
 */
export function columnsPopup(options: ColumnsPopupOptions): Popup {
  const t = useT();
  const current = ref<string[]>([...options.current]);
  const dirty = computed(() => !deepEqual(current.value, [...options.current]));
  const isDefault = computed(() => deepEqual(current.value, [...options.defaults]));

  const apply = (): void => {
    options.onApply(isDefault.value ? undefined : [...current.value]);
    options.onClose(handle.close);
  };

  const guardedClose = (): void => {
    void (async () => {
      if (!dirty.value || ((await unsavedChanges.prompt?.()) ?? true)) {
        options.onClose(handle.close);
      }
    })();
  };

  const closeButton = button(icon('x'), {
    size: -2,
    variant: 'ghost',
    class: 'ohne-ml-auto',
    onClick: guardedClose,
  });
  effect(() => {
    closeButton.title = t('dashboard.close');
  });

  const restoreButton = when(
    () => !isDefault.value,
    () =>
      button([icon('history'), h('span', null, () => t('dashboard.restoreDefaults'))], {
        variant: 'outline',
        onClick: () => {
          current.value = [...options.defaults];
        },
      }),
  );

  const applyButton = button(() => t('dashboard.apply'), {
    variant: 'outline',
    class: 'ohne-ml-auto',
    onClick: apply,
  });
  effect(() => {
    const changed = dirty.value;
    applyButton.classList.toggle('ohne-button-primary', changed);
    applyButton.classList.toggle('ohne-button-outline', !changed);
  });

  const handle = popup(
    tableColumnsConfigurator({
      model: () => current.value,
      fields: options.fields,
      onCommit: (columns) => {
        current.value = columns;
      },
    }),
    {
      size: -1,
      width: '50rem',
      fullHeight: true,
      header: h(
        'div',
        { class: 'ohne-row' },
        h('span', { class: 'o-columns-popup-title' }, () => t('dashboard.columns.title')),
        closeButton,
      ),
      footer: h('div', { class: 'ohne-justify-between' }, restoreButton, applyButton),
      onClose: () => guardedClose(),
    },
  );

  const hotkeys = useHotkeys({ allowInOverlays: true, target: () => handle.root, listen: false });
  setTimeout(() => {
    hotkeys.isListening.value = true;
    hotkeys.listen('save', (event) => {
      event.preventDefault();
      // Blur first and defer, so a width still being typed commits before the entries are read.
      if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
      setTimeout(apply);
    });
  });

  return handle;
}
