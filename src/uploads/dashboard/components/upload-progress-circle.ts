import { css, h, when } from 'ohne/dashboard';
import { batchedEffect, first, isFunction, isUndefined, onCleanup, ref } from 'ohne/utils';

/**
 * Options for `uploadProgressCircle`.
 */
export interface UploadProgressCircleOptions {
  /**
   * The width of the circle's stroke in pixels.
   *
   * @default
   * 3
   */
  strokeWidth?: number;

  /**
   * The color of the background track of the circle.
   *
   * @default
   * 'transparent'
   */
  bgColor?: string;

  /**
   * The color of the animated progress bar.
   *
   * @default
   * 'currentColor'
   */
  progressColor?: string;
}

type SVGAttributes = Record<string, string | number | (() => string | number)>;

const SVG_NS = 'http://www.w3.org/2000/svg';

css`
  .o-upload-progress-circle {
    position: absolute;
    top: 0;
    left: 0;
    display: flex;
    justify-content: center;
    align-items: center;
    width: 100%;
    height: 100%;
  }

  .o-upload-progress-circle-svg {
    max-width: 100%;
    max-height: 100%;
    transform: rotate(-90deg);
  }

  .o-upload-progress-circle-bar {
    stroke-linecap: round;
    transition-property: stroke-dashoffset;
    transition: var(--ohne-transition);
  }

  .o-upload-progress-circle-text {
    position: absolute;
    color: currentColor;
    font-weight: 600;
  }
`;

/**
 * A ring that fills clockwise from the top as `progress` climbs from `0` to `100`, the percentage inside.
 * It covers its positioned parent and sizes the ring to the smaller side, so it fits any square or circle.
 *
 * @example
 * ```ts
 * h('span', { class: 'status' }, uploadProgressCircle(() => task().progress * 100))
 * ```
 */
export function uploadProgressCircle(
  progress: () => number,
  options: UploadProgressCircleOptions = {},
): HTMLElement {
  const strokeWidth = options.strokeWidth ?? 3;
  const size = ref(0);
  const center = (): number => size.value / 2;
  const radius = (): number => center() - strokeWidth / 2;
  const circumference = (): number => 2 * Math.PI * radius();
  const offset = (): number => circumference() - (progress() / 100) * circumference();

  const root = h(
    'div',
    { class: 'o-upload-progress-circle' },
    when(
      () => size.value > 0,
      () =>
        svg(
          'svg',
          {
            class: 'o-upload-progress-circle-svg',
            width: () => size.value,
            height: () => size.value,
            viewBox: () => `0 0 ${size.value} ${size.value}`,
          },
          svg('circle', {
            class: 'o-upload-progress-circle-bg',
            cx: center,
            cy: center,
            r: radius,
            stroke: options.bgColor ?? 'transparent',
            'stroke-width': strokeWidth,
            fill: 'none',
          }),
          svg('circle', {
            class: 'o-upload-progress-circle-bar',
            cx: center,
            cy: center,
            r: radius,
            stroke: options.progressColor ?? 'currentColor',
            'stroke-dasharray': circumference,
            'stroke-dashoffset': offset,
            'stroke-width': strokeWidth,
            fill: 'none',
          }),
        ),
    ),
    h(
      'div',
      { class: 'o-upload-progress-circle-text', style: () => `font-size: ${size.value / 4}px` },
      () => `${Math.round(progress())}%`,
    ),
  );

  const observer = new ResizeObserver((entries) => {
    const entry = first(entries);
    if (isUndefined(entry)) return;
    const { width, height } = entry.contentRect;
    size.value = Math.min(width, height);
  });
  observer.observe(root);
  onCleanup(() => observer.disconnect());

  return root;
}

/**
 * An SVG element with static and reactive attributes; `h` cannot build one, it creates in the HTML namespace.
 */
function svg(tag: string, attributes: SVGAttributes, ...children: SVGElement[]): SVGElement {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [name, value] of Object.entries(attributes)) {
    if (isFunction<() => string | number>(value)) {
      batchedEffect(() => el.setAttribute(name, String(value())));
    } else {
      el.setAttribute(name, String(value));
    }
  }
  el.append(...children);
  return el;
}
