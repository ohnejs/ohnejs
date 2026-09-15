import type { Hotkeys } from 'ohnejs/dashboard';

import { attachTooltip, button, h, icon, useHotkeys, useT } from 'ohnejs/dashboard';
import { isNull, isUndefined, onCleanup } from 'ohnejs/utils';

import type { History } from './history.ts';

/**
 * The undo and redo button pair for a `History` instance.
 *
 * It binds the `undo` and `redo` hotkeys on `hotkeys`, which by default listens on `document`.
 * The default fires while typing too, so the history owns undo and redo over the browser's text undo.
 * A popup passes its own root-targeted instance, since keydowns stop at a popup root.
 * `restore` receives the state returned by `history.undo()`/`history.redo()`, only when one came back.
 * Focus on an element with an `id` returns to that `id` afterwards, with the caret at the end of its text.
 * A `restore` that rebuilds its controls thus keeps the user in the field they were editing.
 * Create it inside a reactive region; the hotkey listener and tooltips die with it.
 */
export function historyButtons<T extends object>(
  history: History<T>,
  restore: (state: T) => void,
  hotkeys: Hotkeys = useHotkeys({ allowInOverlays: true, allowWhileTyping: ['undo', 'redo'] }),
): HTMLElement {
  const t = useT();

  const step = (state: T | undefined, event?: KeyboardEvent): void => {
    event?.preventDefault();
    if (isUndefined(state)) return;
    const focused = document.activeElement?.id ?? '';
    restore(state);
    if (focused !== '') setTimeout(() => refocus(focused));
  };

  const undo = (event?: KeyboardEvent): void => step(history.undo(), event);
  const redo = (event?: KeyboardEvent): void => step(history.redo(), event);

  hotkeys.listen('undo', undo);
  hotkeys.listen('redo', redo);

  const undoButton = button(icon('arrow-back-up'), {
    variant: 'outline',
    disabled: () => !history.canUndo.value,
    onClick: () => undo(),
  });
  onCleanup(
    attachTooltip(
      undoButton,
      () => `${t('dashboard.history.undo')} \`${history.undoCount.value}\``,
    ),
  );

  const redoButton = button(icon('arrow-forward-up'), {
    variant: 'outline',
    disabled: () => !history.canRedo.value,
    onClick: () => redo(),
  });
  onCleanup(
    attachTooltip(
      redoButton,
      () => `${t('dashboard.history.redo')} \`${history.redoCount.value}\``,
    ),
  );

  return h('div', { class: 'o-history-buttons ohne-row' }, undoButton, redoButton);
}

/**
 * Focuses the element with `id`, placing the caret at the end of an input's or textarea's text.
 */
function refocus(id: string): void {
  const el = document.getElementById(id);
  if (isNull(el)) return;
  el.focus();
  if (
    (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) &&
    !isNull(el.selectionStart)
  ) {
    el.setSelectionRange(el.value.length, el.value.length);
  }
}
