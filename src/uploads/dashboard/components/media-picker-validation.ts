import {
  type ConditionObject,
  formatBytes,
  isArray,
  isNumber,
  isString,
  isUndefined,
  mediaCategory,
  mediaTypeMatches,
  parseBytes,
} from 'ohnejs/utils';

import type { UploadRecord } from '../../uploads/types.ts';

/**
 * The bounds an `image`, `file`, `images`, or `files` field puts on the uploads it accepts.
 * Every member is optional; the shape is the field's declared options as the discovery read ships them.
 */
export interface UploadConstraints {
  /**
   * The media types accepted, as `mediaTypeMatches` patterns: exact types, wildcards, or categories.
   */
  types?: readonly string[];

  /**
   * The smallest file accepted, as a `parseBytes` value.
   */
  minSize?: number | string;

  /**
   * The largest file accepted, as a `parseBytes` value.
   */
  maxSize?: number | string;

  /**
   * The fewest pixels wide an accepted image is.
   */
  minWidth?: number;

  /**
   * The most pixels wide an accepted image is.
   */
  maxWidth?: number;

  /**
   * The fewest pixels tall an accepted image is.
   */
  minHeight?: number;

  /**
   * The most pixels tall an accepted image is.
   */
  maxHeight?: number;
}

/**
 * The columns a check reads off an upload; a full record fits.
 */
export type UploadSubject = Pick<UploadRecord, 'kind' | 'type' | 'size' | 'width' | 'height'>;

/**
 * Why an upload fails a field's constraints: an `uploads.errors.*` key and its parameters.
 * The key and parameters match the server's own validation message, so a tooltip reads the same text.
 */
export interface UploadReason {
  /**
   * The message key, like `uploads.errors.fileTooLarge`.
   */
  key: `uploads.errors.${string}`;

  /**
   * The message parameters, when the key takes any.
   */
  params?: Record<string, string | number>;
}

/**
 * Whether an upload satisfies a field's constraints, and why not when it does not.
 */
export type UploadVerdict = { ok: true } | { ok: false; reason: UploadReason };

const OK: UploadVerdict = { ok: true };

const WILDCARD_CATEGORIES: ReadonlySet<string> = new Set(['image', 'video', 'audio', 'font']);

/**
 * Checks an upload against a field's constraints, in the order the server explains them.
 * A folder fails first; then the media type, the size, and, for an image field, the pixel bounds.
 * `image` additionally requires an image, whatever `types` lists.
 * An image with no recorded dimensions passes the pixel bounds, since there is nothing to measure.
 *
 * @example
 * ```ts
 * validateUpload(sunset, { maxSize: '1mb' }, true)
 * // -> { ok: true }
 *
 * validateUpload(notes, {}, true)
 * // -> { ok: false, reason: { key: 'uploads.errors.notAnImage' } }
 *
 * validateUpload(sunset, { minWidth: 1200 }, true)
 * // -> { ok: false, reason: { key: 'uploads.errors.minWidth', params: { min: 1200 } } }
 * ```
 */
export function validateUpload(
  upload: UploadSubject,
  constraints: UploadConstraints,
  image: boolean,
): UploadVerdict {
  if (upload.kind === 'folder') return fail('notAFile');
  const type = upload.type ?? '';
  const size = upload.size ?? 0;
  const { types, minSize, maxSize, minWidth, maxWidth, minHeight, maxHeight } = constraints;
  if (image && mediaCategory(type) !== 'image') return fail('notAnImage');
  if (!isUndefined(types) && !mediaTypeMatches(type, types))
    return fail('typeNotAllowed', { type });
  if (!isUndefined(minSize) && size < parseBytes(minSize)) {
    return fail('fileTooSmall', { min: formatBytes(parseBytes(minSize)) });
  }
  if (!isUndefined(maxSize) && size > parseBytes(maxSize)) {
    return fail('fileTooLarge', { max: formatBytes(parseBytes(maxSize)) });
  }
  if (isNumber(upload.width)) {
    if (!isUndefined(minWidth) && upload.width < minWidth)
      return fail('minWidth', { min: minWidth });
    if (!isUndefined(maxWidth) && upload.width > maxWidth)
      return fail('maxWidth', { max: maxWidth });
  }
  if (isNumber(upload.height)) {
    if (!isUndefined(minHeight) && upload.height < minHeight) {
      return fail('minHeight', { min: minHeight });
    }
    if (!isUndefined(maxHeight) && upload.height > maxHeight) {
      return fail('maxHeight', { max: maxHeight });
    }
  }
  return OK;
}

/**
 * The constraints a field's declared options carry; a member of the wrong shape is dropped.
 *
 * @example
 * ```ts
 * constraintsOf({ types: ['image'], maxSize: '2mb', onDelete: 'setNull' })
 * // -> { types: ['image'], maxSize: '2mb' }
 *
 * constraintsOf(undefined)
 * // -> {}
 * ```
 */
export function constraintsOf(
  options: Readonly<Record<string, unknown>> | undefined,
): UploadConstraints {
  const constraints: UploadConstraints = {};
  if (isUndefined(options)) return constraints;
  if (isArray(options.types) && options.types.every(isString)) constraints.types = options.types;
  if (isSizeValue(options.minSize)) constraints.minSize = options.minSize;
  if (isSizeValue(options.maxSize)) constraints.maxSize = options.maxSize;
  if (isNumber(options.minWidth)) constraints.minWidth = options.minWidth;
  if (isNumber(options.maxWidth)) constraints.maxWidth = options.maxWidth;
  if (isNumber(options.minHeight)) constraints.minHeight = options.minHeight;
  if (isNumber(options.maxHeight)) constraints.maxHeight = options.maxHeight;
  return constraints;
}

/**
 * The `accept` a file input takes for the field's `types`, `undefined` when it must accept everything.
 * Exact types and `image/*` wildcards pass through; the four top-level categories become wildcards.
 * Any other category has no `accept` form, so the whole attribute drops and validation decides after upload.
 *
 * @example
 * ```ts
 * acceptOf(['image', 'application/pdf'])  // -> 'image/*,application/pdf'
 * acceptOf(['document'])                  // -> undefined
 * acceptOf(undefined)                     // -> undefined
 * ```
 */
export function acceptOf(types: readonly string[] | undefined): string | undefined {
  if (isUndefined(types)) return undefined;
  const accepted: string[] = [];
  for (const pattern of types) {
    const wanted = pattern.trim().toLowerCase();
    if (wanted === '*' || wanted === '*/*') return undefined;
    if (wanted.includes('/')) accepted.push(wanted);
    else if (WILDCARD_CATEGORIES.has(wanted)) accepted.push(`${wanted}/*`);
    else return undefined;
  }
  return accepted.length === 0 ? undefined : accepted.join(',');
}

/**
 * The `where` a choices dropdown reads with: files within the constraints the wire grammar can express.
 * Exact types and wildcards filter `type`; the size bounds filter `size`.
 * A category the grammar cannot name drops the whole type filter, so no eligible file goes missing.
 * The pixel bounds are never filtered: the server admits an image with no recorded dimensions.
 *
 * @example
 * ```ts
 * constraintWhere({}, false)
 * // -> { kind: 'file' }
 *
 * constraintWhere({ types: ['image/png'], maxSize: 1024 }, false)
 * // -> { and: [{ kind: 'file' }, { type: 'image/png' }, { size: { atMost: 1024 } }] }
 *
 * constraintWhere({ types: ['document'] }, true)
 * // -> { and: [{ kind: 'file' }, { type: { startsWith: 'image/' } }] }
 * ```
 */
export function constraintWhere(constraints: UploadConstraints, image: boolean): ConditionObject {
  const clauses: ConditionObject[] = [{ kind: 'file' }];
  const types = typeClause(constraints.types);
  if (image) clauses.push({ type: { startsWith: 'image/' } });
  if (!isUndefined(types)) clauses.push(types);
  if (!isUndefined(constraints.minSize)) {
    clauses.push({ size: { atLeast: parseBytes(constraints.minSize) } });
  }
  if (!isUndefined(constraints.maxSize)) {
    clauses.push({ size: { atMost: parseBytes(constraints.maxSize) } });
  }
  return clauses.length === 1 ? (clauses[0] as ConditionObject) : { and: clauses };
}

/**
 * The `type` condition for a list of patterns, `undefined` when any pattern has no wire form.
 */
function typeClause(types: readonly string[] | undefined): ConditionObject | undefined {
  if (isUndefined(types)) return undefined;
  const alternatives: ConditionObject[] = [];
  for (const pattern of types) {
    const wanted = pattern.trim().toLowerCase();
    if (wanted === '*' || wanted === '*/*') return undefined;
    if (wanted.endsWith('/*')) alternatives.push({ type: { startsWith: wanted.slice(0, -1) } });
    else if (wanted.includes('/')) alternatives.push({ type: wanted });
    else if (WILDCARD_CATEGORIES.has(wanted))
      alternatives.push({ type: { startsWith: `${wanted}/` } });
    else return undefined;
  }
  if (alternatives.length === 0) return undefined;
  return alternatives.length === 1 ? alternatives[0] : { or: alternatives };
}

/**
 * The failing verdict for an `uploads.errors.*` key.
 */
function fail(name: string, params?: Record<string, string | number>): UploadVerdict {
  return {
    ok: false,
    reason: isUndefined(params)
      ? { key: `uploads.errors.${name}` }
      : { key: `uploads.errors.${name}`, params },
  };
}

/**
 * Whether a value is a size an option may carry: a byte count or a `parseBytes` string.
 */
function isSizeValue(value: unknown): value is number | string {
  return isNumber(value) || isString(value);
}
