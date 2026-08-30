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
} from 'ohne/dashboard';
import { computed, effect, ref } from 'ohne/utils';

import { unsavedChanges } from './history.ts';
import { orderBy } from './order-by.ts';

/**
 * Options for `sortingPopup`.
 */
export interface SortingPopupOptions {
  /**
   * The sortable field candidates, read reactively.
   */
  fields: () => DashboardField[];

  /**
   * The current order: ohne order strings, a leading `-` meaning descending.
   */
  order: readonly string[];

  /**
   * Called with the rebuilt order strings on Apply.
   */
  onApply(order: string[]): void;

  /**
   * Called when the popup asks to close, with its animated close function.
   * The caller awaits it and then disposes the region that created the popup.
   */
  onClose(close: () => Promise<void>): void;
}

css`
  .o-sorting-popup-title {
    font-weight: 500;
  }
`;

/**
 * The table sorting popup: the `orderBy` builder inside the apply-or-discard shell.
 * A dirty edit guards Escape and the overlay click through the `unsavedChanges` prompt.
 * Create it inside a reactive region; dispose the region after `onClose`'s close resolves.
 */
export function sortingPopup(options: SortingPopupOptions): Popup {
  const t = useT();
  const current = ref<string[]>([...options.order]);
  const baseline = JSON.stringify(options.order);
  const dirty = computed(() => JSON.stringify(current.value) !== baseline);

  const apply = (): void => {
    options.onApply([...current.value]);
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
    orderBy({
      model: () => current.value,
      fields: options.fields,
      onCommit: (order) => {
        current.value = order;
      },
    }),
    {
      size: -1,
      width: '50rem',
      fullHeight: true,
      header: h(
        'div',
        { class: 'ohne-row' },
        h('span', { class: 'o-sorting-popup-title' }, () => t('dashboard.sort.title')),
        closeButton,
      ),
      footer: h('div', { class: 'ohne-justify-between' }, applyButton),
      onClose: () => guardedClose(),
    },
  );

  const hotkeys = useHotkeys({ allowInOverlays: true, target: () => handle.root, listen: false });
  setTimeout(() => {
    hotkeys.isListening.value = true;
    hotkeys.listen('save', (event) => {
      event.preventDefault();
      apply();
    });
  });

  return handle;
}
