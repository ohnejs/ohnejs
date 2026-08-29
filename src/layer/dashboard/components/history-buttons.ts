import { attachTooltip, button, h, icon, useHotkeys, useT } from 'ohne/dashboard';
import { isUndefined, onCleanup } from 'ohne/utils';

import type { History } from './history.ts';

/**
 * The undo and redo button pair for a `History` instance.
 *
 * Two outline buttons, disabled while `canUndo`/`canRedo` say so.
 * Each carries a live tooltip showing the action label and the remaining step count.
 * The pair also binds the `undo` and `redo` hotkeys through `useHotkeys({ allowInOverlays: true })`.
 * Cmd/Ctrl+Z and its redo counterpart keep working while an overlay is open.
 * `restore` receives the state returned by `history.undo()`/`history.redo()`, only when one came back.
 * Create it inside a reactive region; the hotkey listener and tooltips die with it.
 */
export function historyButtons(
  history: History,
  restore: (state: Record<string, unknown>) => void,
): HTMLElement {
  const t = useT();
  const { listen } = useHotkeys({ allowInOverlays: true });

  const undo = (event?: KeyboardEvent): void => {
    event?.preventDefault();
    const state = history.undo();
    if (!isUndefined(state)) restore(state);
  };

  const redo = (event?: KeyboardEvent): void => {
    event?.preventDefault();
    const state = history.redo();
    if (!isUndefined(state)) restore(state);
  };

  listen('undo', undo);
  listen('redo', redo);

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
