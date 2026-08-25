import { css, h } from 'ohne/dashboard';

css`
  .o-wordmark {
    display: block;
    width: fit-content;
    font-size: 1.625rem;
    font-weight: 600;
    letter-spacing: -0.04em;
    line-height: 1.875rem;
  }

  .o-mark {
    display: block;
    width: fit-content;
    font-size: 1.75rem;
    font-weight: 600;
    letter-spacing: -0.04em;
    line-height: 1.75rem;
  }

  .o-logo {
    height: 1.875rem;
    margin-right: auto;
    margin-left: auto;
    color: hsl(var(--ohne-card));
    filter: brightness(0.8);
  }

  .dark .o-logo {
    filter: brightness(1.5);
  }
`;

/**
 * The ohne wordmark, set in the interface face and colored from the current text colour.
 */
export function logoFull(): HTMLElement {
  return h('span', { class: 'o-wordmark' }, 'ohne');
}

/**
 * The ohne mark alone: the `o` glyph, set like the wordmark.
 * The header's logo link sizes and tints it; the glyph carries only its typography.
 */
export function logoMark(): HTMLElement {
  return h('span', { class: 'o-mark' }, 'o');
}

/**
 * The auth screens' logo: the wordmark centered above the card, washed into the surface.
 * It reads as a watermark: card-coloured, darkened a step in light mode and lifted in dark.
 */
export function authLogo(): HTMLElement {
  const logo = logoFull();
  logo.classList.add('o-logo');
  return logo;
}
