import { css, icon } from 'ohnejs/dashboard';

css`
  .o-ai-spinner {
    animation: o-ai-spin 1s linear infinite;
  }

  @keyframes o-ai-spin {
    to {
      transform: rotate(360deg);
    }
  }
`;

/**
 * The spinning loader of a line that waits on the assistant.
 */
export function spinner(): SVGSVGElement {
  const glyph = icon('loader-2');
  glyph.classList.add('o-ai-spinner');
  return glyph;
}
