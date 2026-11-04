import { onCleanup } from '../../utils/reactive/effect-scope.ts';
import { css } from '../render/css.ts';
import { h } from '../render/h.ts';
import { resolveText, type Text } from '../runtime/text.ts';
import { icon } from './icon.ts';
import { attachTooltip } from './tooltip.ts';

css`
  .ohne-help {
    display: inline-flex;
    flex-shrink: 0;
    border-radius: 9999px;
    color: hsl(var(--ohne-muted-foreground));
    font-size: 1.125em;
    cursor: help;
    opacity: 0.7;
  }

  @media (hover: hover) {
    .ohne-help:hover {
      opacity: 1;
    }
  }

  .ohne-help:focus-visible {
    opacity: 1;
    box-shadow:
      0 0 0 0.125rem hsl(var(--ohne-background)),
      0 0 0 0.25rem hsl(var(--ohne-ring)),
      0 0 #0000;
    outline: 0.125rem solid transparent;
    outline-offset: 0.125rem;
  }
`;

/**
 * The muted info icon beside a label, its help in a tooltip on hover and focus.
 * On touch a tap pins the help and does nothing else.
 */
export function helpIcon(help: Text): HTMLElement {
  let touched = false;
  const element = h(
    'span',
    {
      class: 'ohne-help ohne-hit',
      tabindex: 0,
      role: 'note',
      'aria-label': () => resolveText(help),
      onPointerdown: (event: PointerEvent) => {
        touched = event.pointerType === 'touch';
      },
      onClick: (event: MouseEvent) => {
        if (!touched) return;
        event.preventDefault();
        event.stopPropagation();
      },
    },
    icon('info-circle-filled'),
  );
  onCleanup(
    attachTooltip(element, () => resolveText(help), {
      maxWidth: 260,
      plain: true,
      offset: 14,
      tap: true,
    }),
  );
  return element;
}
