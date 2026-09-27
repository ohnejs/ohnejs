import type { Message, ResolvedOptions, Transaction } from 'ohnejs';

import { option, queryUntyped } from 'ohnejs';
import {
  formatBytes,
  isArray,
  isNull,
  isUndefined,
  mediaCategory,
  mediaTypeMatches,
  parseBytes,
  uniqueArray,
} from 'ohnejs/utils';

import { validationMessage } from '../../ohne/fields/validation-message.ts';

/**
 * The `Uploads` columns a constraint reads, in the two shapes a row takes.
 */
type UploadRow =
  | { kind: 'folder' }
  | { kind: 'file'; type: string; size: number; width: number | null; height: number | null };

/**
 * The constraints a checked upload must satisfy: an `image` field's resolved options, every member optional.
 * A `file` field's resolved options fit too, since they are a subset.
 */
export type UploadConstraints = Partial<ResolvedOptions<typeof imageOptions>>;

/**
 * The slice of a validate context the upload checks read.
 */
export interface UploadCheckContext {
  /**
   * The field's resolved options, read for the constraints alone.
   */
  options: UploadConstraints;

  /**
   * The open write transaction the referenced rows are read on.
   */
  tx: Transaction;

  /**
   * The field's error slice, where a list check keys each failing item as `[i]`.
   */
  errors: Record<string, Message>;
}

/**
 * The count a written list must satisfy.
 */
export interface ListBounds {
  /**
   * Whether a provided empty list is a legal value.
   */
  allowEmpty: boolean;

  /**
   * The fewest links the list may hold.
   */
  min?: number;

  /**
   * The most links the list may hold.
   */
  max?: number;
}

const sizeOptions = {
  /**
   * The smallest file the field accepts, in bytes or as a string like `'10kb'`.
   */
  minSize: option<number | string>(),

  /**
   * The largest file the field accepts, in bytes or as a string like `'5mb'`.
   */
  maxSize: option<number | string>(),
};

/**
 * The options a `file` or `files` field declares: which uploads it accepts, by media type and by size.
 */
export const fileOptions = {
  /**
   * The media types the field accepts.
   * A pattern is an exact type (`application/pdf`), a wildcard (`image/*`), or a category (`document`).
   * Omitted, any file is accepted.
   */
  types: option<readonly string[]>(),

  ...sizeOptions,
};

/**
 * The options an `image` or `images` field declares: `fileOptions` narrowed to images, plus pixel bounds.
 */
export const imageOptions = {
  /**
   * The media types the field accepts.
   * A pattern is an exact type (`image/png`), a wildcard (`image/*`), or a category (`image`).
   * A referenced upload must be an image whatever this lists.
   *
   * @default
   * ['image']
   */
  types: option<readonly string[]>({ default: ['image'] }),

  ...sizeOptions,

  /**
   * The fewest pixels wide an accepted image is.
   */
  minWidth: option<number>(),

  /**
   * The most pixels wide an accepted image is.
   */
  maxWidth: option<number>(),

  /**
   * The fewest pixels tall an accepted image is.
   */
  minHeight: option<number>(),

  /**
   * The most pixels tall an accepted image is.
   */
  maxHeight: option<number>(),
};

/**
 * The options every list of uploads declares: how many links a written list may hold.
 */
export const listOptions = {
  /**
   * Whether an empty list is a legal value.
   * With `false`, supplying `[]` is rejected, so the field requires at least one link.
   *
   * @default
   * true
   */
  allowEmpty: option({ default: true }),

  /**
   * The fewest links a written list may hold.
   */
  min: option<number>(),

  /**
   * The most links a written list may hold.
   */
  max: option<number>(),
};

/**
 * An `uploads.errors.*` failure as its `{ key, params }` message object.
 * Once `KnownMessages` has keys, the object must name one of them.
 * In this repo's typecheck only test fixtures supply those keys, so the cast bridges it.
 */
function uploadsMessage(name: string, params: Record<string, unknown>): Message {
  return { key: `uploads.errors.${name}`, params } as unknown as Message;
}

/**
 * Reads the constraint columns of the listed uploads on the write's transaction, keyed by `UUID`.
 * A `UUID` no row answers is left out; the pipeline's reference check reports it.
 */
async function readUploads(
  tx: Transaction,
  uuids: readonly string[],
): Promise<Map<string, UploadRow>> {
  const rows = await queryUntyped('Uploads')
    .use(tx)
    .where({ UUID: { in: uniqueArray(uuids) } })
    .select('UUID', 'kind', 'type', 'size', 'width', 'height')
    .findMany();
  return new Map(rows.map((row) => [row.UUID as string, row as unknown as UploadRow]));
}

/**
 * Checks one upload row against the constraints, in the order a picker would explain them.
 * A folder fails first; then the media type, the size, and, for an image field, the pixel bounds.
 * An image with no recorded dimensions passes the pixel bounds, since there is nothing to measure.
 * Returns the first failure, or `undefined` when the row satisfies every constraint.
 */
function checkRow(
  row: UploadRow,
  constraints: UploadConstraints,
  image: boolean,
): Message | undefined {
  if (row.kind === 'folder') return 'uploads.errors.notAFile';
  const { types, minSize, maxSize, minWidth, maxWidth, minHeight, maxHeight } = constraints;
  if (image && mediaCategory(row.type) !== 'image') return 'uploads.errors.notAnImage';
  if (!isUndefined(types) && !mediaTypeMatches(row.type, types)) {
    return uploadsMessage('typeNotAllowed', { type: row.type });
  }
  if (!isUndefined(minSize) && row.size < parseBytes(minSize)) {
    return uploadsMessage('fileTooSmall', { min: formatBytes(parseBytes(minSize)) });
  }
  if (!isUndefined(maxSize) && row.size > parseBytes(maxSize)) {
    return uploadsMessage('fileTooLarge', { max: formatBytes(parseBytes(maxSize)) });
  }
  if (!isNull(row.width)) {
    if (!isUndefined(minWidth) && row.width < minWidth) {
      return uploadsMessage('minWidth', { min: minWidth });
    }
    if (!isUndefined(maxWidth) && row.width > maxWidth) {
      return uploadsMessage('maxWidth', { max: maxWidth });
    }
  }
  if (!isNull(row.height)) {
    if (!isUndefined(minHeight) && row.height < minHeight) {
      return uploadsMessage('minHeight', { min: minHeight });
    }
    if (!isUndefined(maxHeight) && row.height > maxHeight) {
      return uploadsMessage('maxHeight', { max: maxHeight });
    }
  }
  return undefined;
}

/**
 * Checks the one upload an `image` or `file` field references, reading its row on the write's transaction.
 * `image` additionally requires the row to be an image, so the pixel bounds have something to measure.
 * A `UUID` with no row passes here: the pipeline's reference check reports it as `invalidReference`.
 *
 * @example
 * ```ts
 * validators: [(value, ctx) => checkUpload(value, ctx, true)]
 * ```
 */
export async function checkUpload(
  uuid: string,
  ctx: UploadCheckContext,
  image: boolean,
): Promise<Message | undefined> {
  const row = (await readUploads(ctx.tx, [uuid])).get(uuid);
  return isUndefined(row) ? undefined : checkRow(row, ctx.options, image);
}

/**
 * Checks every upload an `images` or `files` field lists, reading the rows once on the write's transaction.
 * A failing item keys its message as `[i]` in `ctx.errors`, so the failure reads at the item's position.
 * A `UUID` with no row passes here: the pipeline's reference check reports it at the same key.
 * A non-list passes untouched, since the pipeline rejects it before any validator runs.
 *
 * @example
 * ```ts
 * validators: [(value, ctx) => checkUploadList(value, ctx, true)]
 * ```
 */
export async function checkUploadList(
  value: unknown,
  ctx: UploadCheckContext,
  image: boolean,
): Promise<undefined> {
  if (!isArray<string[]>(value) || value.length === 0) return undefined;
  const rows = await readUploads(ctx.tx, value);
  for (const [index, uuid] of value.entries()) {
    const row = rows.get(uuid);
    if (isUndefined(row)) continue;
    const message = checkRow(row, ctx.options, image);
    if (!isUndefined(message)) ctx.errors[`[${index}]`] = message;
  }
  return undefined;
}

/**
 * Checks a written list's length against `allowEmpty`, `min`, and `max`, as the built-in `records` does.
 * Returns the first failure, or `undefined`; a non-list passes, since the pipeline rejects it first.
 *
 * @example
 * ```ts
 * checkListSize([], { allowEmpty: false })
 * // -> 'validation.emptyValue'
 *
 * checkListSize(['u1'], { allowEmpty: true, min: 2 })
 * // -> { key: 'validation.minItems', params: { min: 2 } }
 * ```
 */
export function checkListSize(value: unknown, bounds: ListBounds): Message | undefined {
  if (!isArray(value)) return undefined;
  if (!bounds.allowEmpty && value.length === 0) return 'validation.emptyValue';
  const { min, max } = bounds;
  if (!isUndefined(min) && value.length < min) {
    return validationMessage('validation.minItems', { min });
  }
  if (!isUndefined(max) && value.length > max) {
    return validationMessage('validation.maxItems', { max });
  }
  return undefined;
}
