import { bubble, button, useT } from 'ohnejs/dashboard';

/**
 * The footer button that clears a selection: a `square-off` icon carrying the count in its bubble.
 * The collection table and the media library render the same one, so a selection reads alike in both.
 */
export function clearSelectionButton(count: () => number, onClear: () => void): HTMLElement {
  const t = useT();
  return button(() => t('dashboard.clearSelection'), {
    icon: 'square-off',
    iconOnly: true,
    variant: 'accent',
    bubble: bubble(count),
    onClick: onClear,
  });
}
