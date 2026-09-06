import { attachTooltip, bubble, button, icon, useT } from 'ohne/dashboard';
import { onCleanup } from 'ohne/utils';

/**
 * The footer button that clears a selection: a `square-off` icon carrying the count in its bubble.
 * The collection table and the media library render the same one, so a selection reads alike in both.
 */
export function clearSelectionButton(count: () => number, onClear: () => void): HTMLElement {
  const t = useT();
  const el = button(icon('square-off'), {
    variant: 'accent',
    bubble: bubble(count),
    onClick: onClear,
  });
  onCleanup(attachTooltip(el, () => t('dashboard.clearSelection')));
  return el;
}
