import { attachTooltip, button, css, icon, type IconName } from 'ohnejs/dashboard';
import { onCleanup } from 'ohnejs/utils';

css`
  .o-item-actions {
    flex-shrink: 0;
    display: flex;
    gap: 0.25rem;
    margin-left: auto;
  }

  @media (hover: hover) {
    .o-item-actions {
      display: none;
    }
  }

  :where(.ohne-card:hover, .ohne-card:focus-within) > .ohne-card-header > * > .o-item-actions {
    display: flex;
  }
`;

/**
 * One item-row action: a small ghost icon button with a tooltip.
 * Grouped in a `div.o-item-actions` inside a card header, the group reveals on hover and focus.
 */
export function actionButton(
  glyph: IconName,
  tooltip: () => string,
  onClick: () => void,
  extras: { disabled?: () => boolean; destructiveHover?: boolean } = {},
): HTMLElement {
  const control = button(icon(glyph), {
    size: -2,
    variant: 'ghost',
    destructiveHover: extras.destructiveHover,
    disabled: extras.disabled,
    onClick,
  });
  onCleanup(attachTooltip(control, tooltip));
  return control;
}
