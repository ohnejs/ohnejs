import type { MaybeGetter } from '../../utils/reactive/to-value.ts';
import type { Text } from '../runtime/text.ts';

import { qrMatrix } from '../../utils/qr/qr-matrix.ts';
import { toValue } from '../../utils/reactive/to-value.ts';
import { css } from '../render/css.ts';
import { h } from '../render/h.ts';
import { svg } from '../render/svg.ts';
import { resolveText } from '../runtime/text.ts';
import './tokens.ts';

/**
 * Options for `qrCode`.
 */
export interface QRCodeOptions {
  /**
   * What the code holds, named for screen readers, such as "Authenticator setup code".
   */
  label: Text;

  /**
   * The CSS length of each side, quiet zone included.
   *
   * @default
   * '12em'
   */
  size?: string;
}

const QUIET_ZONE = 4;

css`
  .ohne-qr-code {
    flex-shrink: 0;
    display: inline-block;
    aspect-ratio: 1;
    overflow: hidden;
    border-radius: var(--ohne-radius);
    background-color: #fff;
  }

  .ohne-qr-code > svg {
    display: block;
    width: 100%;
    height: 100%;
    fill: #000;
  }
`;

/**
 * A scannable QR code of `text`, black on white in either color mode, with its quiet zone drawn in.
 * A getter keeps the code live.
 *
 * @example
 * ```ts
 * qrCode(() => enrolment.value.uri, { label: 'Authenticator setup code' })
 * ```
 */
export function qrCode(text: MaybeGetter<string>, options: QRCodeOptions): HTMLElement {
  const { label, size = '12em' } = options;
  return h(
    'span',
    {
      class: 'ohne-qr-code',
      role: 'img',
      'aria-label': () => resolveText(label),
      style: `width: ${size}`,
    },
    () => {
      const matrix = qrMatrix(toValue(text));
      const side = matrix.length + QUIET_ZONE * 2;
      return svg(
        'svg',
        { viewBox: `0 0 ${side} ${side}`, 'shape-rendering': 'crispEdges', 'aria-hidden': 'true' },
        svg('path', { d: modulePath(matrix) }),
      );
    },
  );
}

function modulePath(matrix: readonly (readonly boolean[])[]): string {
  let path = '';
  for (const [y, row] of matrix.entries()) {
    for (let x = 0; x < row.length; x += 1) {
      if (!row[x]) continue;
      const start = x;
      while (row[x + 1]) x += 1;
      path += `M${start + QUIET_ZONE},${y + QUIET_ZONE}h${x - start + 1}v1h${start - x - 1}z`;
    }
  }
  return path;
}
