import { css } from 'ohne/dashboard';
import { clamp, easeInOutCubic, onCleanup } from 'ohne/utils';

import { LOGO_GLYPHS, LOGO_HEIGHT, LOGO_WELL_X, LOGO_WELL_Y, logoFrame } from './logo-model.ts';

/**
 * A live ohne mark.
 * It rests as the solid dot.
 * `expand` unfolds the `ohne` wordmark out of it and `collapse` folds it back.
 */
export interface Logo {
  /**
   * The SVG element.
   * Size it through its CSS height; the width follows the wordmark as it unfolds.
   */
  readonly el: SVGSVGElement;

  /**
   * Unfolds the dot into the full wordmark.
   */
  expand(): void;

  /**
   * Folds the wordmark back into the solid dot.
   */
  collapse(): void;
}

const NS = 'http://www.w3.org/2000/svg';
const EXPAND_MS = 720;
const COLLAPSE_MS = 1150;
const INTRO_MS = 400;

const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');

let wells = 0;

css`
  .o-logo {
    display: block;
    overflow: visible;
  }

  .o-auth-logo {
    height: 1.875rem;
    margin-right: auto;
    margin-left: auto;
    color: hsl(var(--ohne-card));
    filter: brightness(0.8);
  }

  .dark .o-auth-logo {
    filter: brightness(1.5);
  }
`;

/**
 * Builds a live ohne mark, resting as the solid dot.
 * The wordmark's letters fold into the `o` through a mask cut to its counter, so nothing shows inside.
 * The dot breathes slightly while letters flow and settles once they stop.
 * Under reduced motion every change lands in one step.
 * The animation frame is cancelled with the enclosing scope.
 */
export function logo(): Logo {
  const id = `o-logo-well-${++wells}`;
  const well = { cx: `${LOGO_WELL_X}`, cy: `${LOGO_WELL_Y}` };

  const hole = svgElement('circle', { ...well, r: '16', fill: '#000', stroke: 'none' });
  const mask = svgElement('mask', {
    id,
    maskUnits: 'userSpaceOnUse',
    x: '-80',
    y: '-80',
    width: '440',
    height: '260',
  });
  mask.append(
    svgElement('rect', { x: '-80', y: '-80', width: '440', height: '260', fill: '#fff' }),
    hole,
  );
  const defs = svgElement('defs');
  defs.append(mask);

  const glyphs = LOGO_GLYPHS.map((d) => {
    const glyph = svgElement('g');
    glyph.append(svgElement('path', { d }));
    return glyph;
  });
  const word = svgElement('g', { mask: `url(#${id})` });
  word.append(...glyphs);

  const ring = svgElement('circle', { ...well, r: '20' });
  const dot = svgElement('g');
  dot.append(ring);

  const el = svgElement('svg', {
    class: 'o-logo',
    viewBox: `0 0 48 ${LOGO_HEIGHT}`,
    fill: 'none',
    stroke: 'currentColor',
    'stroke-width': '8',
    'stroke-linejoin': 'round',
    role: 'img',
    'aria-label': 'ohne',
  });
  el.append(defs, word, dot);

  let fold = 1;
  let from = 1;
  let to = 1;
  let since = 0;
  let duration = 0;
  let pulse = 0;
  let previous = 1;
  let request = 0;
  let drawn = -1;
  let drawnPulse = -1;
  let drawnWidth = 0;

  const draw = (): void => {
    if (Math.abs(fold - drawn) >= 0.0002) {
      drawn = fold;
      const frame = logoFrame(fold);
      frame.glyphs.forEach((glyph, i) => {
        glyphs[i].setAttribute('transform', matrix(glyph.scale, glyph.x, glyph.y));
      });
      ring.setAttribute('r', frame.ring.toFixed(3));
      ring.setAttribute('stroke-width', frame.stroke.toFixed(3));
      hole.setAttribute('r', frame.hole.toFixed(3));
      // A viewBox write relayouts the document, so it lands only on a quarter-unit change.
      const width = Math.round(frame.width * 4) / 4;
      if (width !== drawnWidth) {
        drawnWidth = width;
        el.setAttribute('viewBox', `0 0 ${width} ${LOGO_HEIGHT}`);
      }
    }
    if (pulse !== drawnPulse) {
      drawnPulse = pulse;
      const breath = 1 + pulse * 0.04;
      dot.setAttribute(
        'transform',
        matrix(breath, LOGO_WELL_X * (1 - breath), LOGO_WELL_Y * (1 - breath)),
      );
    }
  };

  const tick = (now: number): void => {
    const t = duration === 0 ? 1 : (now - since) / duration;
    fold = from + (to - from) * easeInOutCubic(t);
    pulse = reducedMotion.matches ? 0 : clamp(Math.abs(fold - previous) * 24, pulse * 0.9, 1);
    previous = fold;
    if (pulse < 0.002) pulse = 0;
    draw();
    request = t < 1 || pulse > 0 ? requestAnimationFrame(tick) : 0;
  };

  const go = (target: number, ms: number): void => {
    if (target === to) return;
    from = fold;
    to = target;
    duration = reducedMotion.matches ? 0 : ms;
    since = performance.now();
    if (request === 0) request = requestAnimationFrame(tick);
  };

  draw();
  onCleanup(() => cancelAnimationFrame(request));

  return {
    el,
    expand: () => go(0, EXPAND_MS),
    collapse: () => go(1, COLLAPSE_MS),
  };
}

/**
 * The auth screens' logo: the dot centred above the card, unfolding into the wordmark after a beat.
 * It stays centred while it unfolds and never folds back.
 * Under reduced motion it starts unfolded.
 * It reads as a watermark: card-coloured, darkened a step in light mode and lifted in dark.
 */
export function authLogo(): SVGSVGElement {
  const mark = logo();
  mark.el.classList.add('o-auth-logo');
  if (reducedMotion.matches) {
    mark.expand();
  } else {
    const intro = setTimeout(() => mark.expand(), INTRO_MS);
    onCleanup(() => clearTimeout(intro));
  }
  return mark.el;
}

/**
 * Creates an SVG-namespaced element with its attributes set.
 */
function svgElement<K extends keyof SVGElementTagNameMap>(
  tag: K,
  attributes: Record<string, string> = {},
): SVGElementTagNameMap[K] {
  const el = document.createElementNS(NS, tag);
  for (const [name, value] of Object.entries(attributes)) el.setAttribute(name, value);
  return el;
}

/**
 * A uniform-scale SVG `matrix` transform: scale about the origin, then offset by `x` and `y`.
 */
function matrix(scale: number, x: number, y: number): string {
  return `matrix(${scale.toFixed(4)} 0 0 ${scale.toFixed(4)} ${x.toFixed(2)} ${y.toFixed(2)})`;
}
