import { type Child, css, h } from 'ohne/dashboard';

css`
  body {
    --ohne-dialog-size: -1;
    --ohne-toast-size: -1;
    --ohne-tooltip-size: -1;
  }

  .o-wrapper {
    --ohne-size: -1;
    --ohne-spacing: -1;
    position: relative;
    display: flex;
    justify-content: center;
    min-height: 100dvh;
    transition: var(--ohne-transition);
    transition-property: opacity filter transform;
    transition-duration: var(--ohne-overlay-transition-duration);
  }

  .ohne-overlay-active .o-wrapper {
    opacity: 0.36;
    filter: blur(1px);
    transform: scale(0.97);
  }

  .o-wrapper::before,
  .o-wrapper::after {
    content: '';
    display: block;
    width: 1px;
    background-color: hsl(var(--ohne-border));
  }
`;

/**
 * The dashboard's page column: content centered between two vertical rail lines.
 * The whole dashboard runs one size step down through it, and overlays one further.
 * While an overlay is open, `ohne-overlay-active` on an ancestor recedes the wrapper behind it.
 * Layouts butt against the rails with negative horizontal margins.
 */
export function wrapper(...children: Child[]): HTMLElement {
  return h('div', { class: 'o-wrapper' }, children);
}
