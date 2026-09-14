import { isInteger, isNull, isRealNumber, isUndefined } from 'ohnejs/utils';

import { ohneError } from '../../ohne/error/ohne-error.ts';

/**
 * How an image is fitted into a requested box.
 * `cover` fills the box and crops, `contain` letterboxes, `inside` shrinks to fit without padding.
 */
export type ImageFit = 'cover' | 'contain' | 'inside';

/**
 * The encoded format of a variant.
 * `auto` lets the service pick from the request's `Accept` header.
 */
export type ImageFormat = 'webp' | 'avif' | 'jpeg' | 'png' | 'auto';

/**
 * Where a `cover` crop keeps its subject when no focal point is given.
 */
export type ImagePosition =
  | 'center'
  | 'top'
  | 'topRight'
  | 'right'
  | 'bottomRight'
  | 'bottom'
  | 'bottomLeft'
  | 'left'
  | 'topLeft';

/**
 * The transforms an image variant URL asks the image service for.
 * Every field is optional; the canonical token string omits defaults, so one variant has one URL.
 */
export interface ImageTransforms {
  /**
   * The target width in pixels, a positive integer.
   */
  width?: number;

  /**
   * The target height in pixels, a positive integer.
   */
  height?: number;

  /**
   * How the image fits the box.
   *
   * @default
   * 'cover'
   */
  fit?: ImageFit;

  /**
   * The output format.
   * Omitted, the service keeps the source format.
   */
  format?: ImageFormat;

  /**
   * The encoding quality, `1` to `100`.
   * Omitted, the service applies its own default.
   */
  quality?: number;

  /**
   * Where a crop keeps its subject.
   * A `focalPoint` takes precedence.
   *
   * @default
   * 'center'
   */
  position?: ImagePosition;

  /**
   * The point a crop keeps in view, each axis `0` to `1`, rounded to three decimals.
   */
  focalPoint?: {
    /**
     * The horizontal position, `0` at the left edge.
     */
    x: number;

    /**
     * The vertical position, `0` at the top edge.
     */
    y: number;
  };

  /**
   * The device pixel ratio the target size is multiplied by, `1` to `4`.
   *
   * @default
   * 1
   */
  dpr?: number;
}

const FITS: readonly ImageFit[] = ['cover', 'contain', 'inside'];

const FORMATS: readonly ImageFormat[] = ['webp', 'avif', 'jpeg', 'png', 'auto'];

const POSITIONS: readonly ImagePosition[] = [
  'center',
  'top',
  'topRight',
  'right',
  'bottomRight',
  'bottom',
  'bottomLeft',
  'left',
  'topLeft',
];

const TOKEN = /^([a-z]+)_(.+)$/;

const FOCAL = /^(\d(?:\.\d{1,3})?)_(\d(?:\.\d{1,3})?)$/;

/**
 * Serializes transforms into their canonical token string.
 * A full one reads `w_800,h_600,fit_contain,f_webp,q_80,fp_0.3_0.6,dpr_2`.
 *
 * Tokens keep a fixed order and a default is never written, so equal transforms always produce one string.
 * A `focalPoint` replaces `position`; a focal axis is rounded to three decimals.
 * Returns `''` when nothing is asked for.
 * An out-of-range value throws, since transforms come from server code.
 *
 * @example
 * ```ts
 * stringifyImageTransforms({ width: 800, format: 'webp' })       // -> 'w_800,f_webp'
 * stringifyImageTransforms({ width: 800, fit: 'cover', dpr: 1 }) // -> 'w_800'
 * stringifyImageTransforms({ focalPoint: { x: 0.25, y: 1 } })     // -> 'fp_0.25_1'
 * stringifyImageTransforms({})                                  // -> ''
 * ```
 */
export function stringifyImageTransforms(transforms: ImageTransforms): string {
  const tokens: string[] = [];
  const { width, height, fit, format, quality, position, focalPoint, dpr } = transforms;
  if (!isUndefined(width)) tokens.push(`w_${positiveInteger('width', width)}`);
  if (!isUndefined(height)) tokens.push(`h_${positiveInteger('height', height)}`);
  if (!isUndefined(fit) && fit !== 'cover') tokens.push(`fit_${oneOf('fit', fit, FITS)}`);
  if (!isUndefined(format)) tokens.push(`f_${oneOf('format', format, FORMATS)}`);
  if (!isUndefined(quality)) tokens.push(`q_${bounded('quality', quality, 1, 100, true)}`);
  if (!isUndefined(focalPoint)) {
    tokens.push(`fp_${focalAxis('x', focalPoint.x)}_${focalAxis('y', focalPoint.y)}`);
  } else if (!isUndefined(position) && position !== 'center') {
    tokens.push(`p_${oneOf('position', position, POSITIONS)}`);
  }
  if (!isUndefined(dpr) && dpr !== 1) tokens.push(`dpr_${bounded('dpr', dpr, 1, 4, false)}`);
  return tokens.join(',');
}

/**
 * Parses a token string back into transforms, or `undefined` when it is not valid.
 *
 * Every token must be known, well-formed, in range, and unique; `p` and `fp` exclude each other.
 * Order is not enforced, so a service can parse a string it already verified by signature.
 * `''` parses to no transforms at all.
 *
 * @example
 * ```ts
 * parseImageTransforms('w_800,f_webp')   // -> { width: 800, format: 'webp' }
 * parseImageTransforms('fp_0.25_1')      // -> { focalPoint: { x: 0.25, y: 1 } }
 * parseImageTransforms('w_800,w_600')    // -> undefined
 * parseImageTransforms('rotate_90')      // -> undefined
 * ```
 */
export function parseImageTransforms(tokens: string): ImageTransforms | undefined {
  const transforms: ImageTransforms = {};
  if (tokens === '') return transforms;
  const seen = new Set<string>();
  for (const token of tokens.split(',')) {
    const match = TOKEN.exec(token);
    if (isNull(match) || seen.has(match[1])) return undefined;
    seen.add(match[1]);
    if (!parseToken(transforms, match[1], match[2])) return undefined;
  }
  if (seen.has('p') && seen.has('fp')) return undefined;
  return transforms;
}

/**
 * Applies one parsed token to `transforms`, reporting whether it was valid.
 */
function parseToken(transforms: ImageTransforms, name: string, value: string): boolean {
  switch (name) {
    case 'w':
    case 'h': {
      const size = Number(value);
      if (!/^[1-9]\d*$/.test(value)) return false;
      transforms[name === 'w' ? 'width' : 'height'] = size;
      return true;
    }
    case 'fit':
      return assign(transforms, 'fit', value, FITS);
    case 'f':
      return assign(transforms, 'format', value, FORMATS);
    case 'p':
      return assign(transforms, 'position', value, POSITIONS);
    case 'q': {
      if (!/^(?:[1-9]\d?|100)$/.test(value)) return false;
      transforms.quality = Number(value);
      return true;
    }
    case 'fp': {
      const focal = FOCAL.exec(value);
      if (isNull(focal)) return false;
      const x = Number(focal[1]);
      const y = Number(focal[2]);
      if (x > 1 || y > 1 || String(x) !== focal[1] || String(y) !== focal[2]) return false;
      transforms.focalPoint = { x, y };
      return true;
    }
    case 'dpr': {
      const ratio = Number(value);
      if (!/^\d(?:\.\d{1,2})?$/.test(value) || ratio < 1 || ratio > 4 || String(ratio) !== value) {
        return false;
      }
      transforms.dpr = ratio;
      return true;
    }
    default:
      return false;
  }
}

/**
 * Sets an enumerated transform when `value` is one of `allowed`.
 */
function assign<K extends 'fit' | 'format' | 'position'>(
  transforms: ImageTransforms,
  key: K,
  value: string,
  allowed: readonly NonNullable<ImageTransforms[K]>[],
): boolean {
  const found = allowed.find((candidate) => candidate === value);
  if (isUndefined(found)) return false;
  transforms[key] = found;
  return true;
}

/**
 * A positive integer, or the throw that names the offending transform.
 */
function positiveInteger(name: string, value: number): number {
  if (!isInteger(value) || value <= 0) invalid(name, value, 'a positive integer');
  return value;
}

/**
 * A number within `min` and `max`, integer when `integer` is set, or the throw naming the transform.
 */
function bounded(name: string, value: number, min: number, max: number, integer: boolean): number {
  const whole = integer ? isInteger(value) : isRealNumber(value);
  if (!whole || value < min || value > max)
    invalid(name, value, `between \`${min}\` and \`${max}\``);
  return value;
}

/**
 * A focal axis rounded to three decimals, or the throw naming it.
 */
function focalAxis(axis: string, value: number): number {
  if (!isRealNumber(value) || value < 0 || value > 1)
    invalid(`focalPoint.${axis}`, value, 'between `0` and `1`');
  return Math.round(value * 1000) / 1000;
}

/**
 * The value itself when it is one of `allowed`, or the throw naming the transform.
 */
function oneOf<T extends string>(name: string, value: T, allowed: readonly T[]): T {
  if (!allowed.includes(value))
    invalid(name, value, `one of ${allowed.map((v) => `\`${v}\``).join(', ')}`);
  return value;
}

/**
 * Throws the one error every invalid transform reports.
 */
function invalid(name: string, value: unknown, expected: string): never {
  throw ohneError(`Invalid image transform \`${name}\`: \`${String(value)}\` is not ${expected}`);
}
