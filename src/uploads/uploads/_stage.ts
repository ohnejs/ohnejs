import type { Transaction } from 'ohnejs';

import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import { ohneError, queryUntyped, useDatabase } from 'ohnejs';
import {
  decodeText,
  formatBytes,
  imageSize,
  isUndefined,
  limitStream,
  mediaCategory,
  mediaTypesCompatible,
  parseBytes,
  sanitizeSVG,
  sniffMediaType,
  uuidv7,
  uuidv7Time,
} from 'ohnejs/utils';

import { useUploadsConfig } from '../config.ts';
import { drainJournal, journalStorage } from '../storage/journal.ts';
import { useStorage } from '../storage/use-storages.ts';
import { dispositionFor } from './_disposition.ts';
import { uploadsError } from './_errors.ts';
import { TEMP_PREFIX } from './path.ts';

/**
 * What staging learned about the bytes it wrote to the temp object.
 */
export interface StagedUpload {
  /**
   * The temp object's storage key, to move into place once the row commits.
   */
  temp: string;

  /**
   * The byte count actually written.
   */
  size: number;

  /**
   * The sha256 of the written bytes, in hex.
   */
  hash: string;

  /**
   * The displayed width in pixels, `null` unless the bytes are a sized image.
   */
  width: number | null;

  /**
   * The displayed height in pixels, `null` unless the bytes are a sized image.
   */
  height: number | null;
}

const PEEK_SIZE = 64 * 1024;

const SVG = 'image/svg+xml';

/**
 * Streams an upload's bytes into a temp object, verifying and measuring them on the way.
 *
 * The first 64 KiB are peeked: bytes whose sniffed type contradicts `type` are refused as `contentMismatch`.
 * An image's dimensions are read from that head.
 * An SVG is buffered whole, sanitized, and re-measured; input without an `<svg>` root is refused as `notSVG`.
 * Reading stops the moment an SVG passes `uploads.maxSVGSize`: `fileTooLarge`, whatever `maxFileSize` allows.
 * The bytes then flow through a sha256 counter into `storage.write` under the `.tmp/` prefix.
 * The temp object is journaled as a `stage` entry first, so `sweepStaged` finds it if its row never commits.
 * The journal is bookkeeping, so its reads and writes skip the app's scoping hooks.
 * `size` is the request's declared length, a hint for a backend that needs it up front.
 * The disposition the API route serves `type` with goes along, for a backend that serves the object itself.
 */
export async function stageUpload(
  body: ReadableStream<Uint8Array>,
  { type, size }: { type: string; size?: number },
): Promise<StagedUpload> {
  const { head, stream } = await peek(body, PEEK_SIZE);
  const sniffed = sniffMediaType(head);
  if (!isUndefined(sniffed) && !mediaTypesCompatible(type, sniffed)) {
    await stream.cancel();
    throw uploadsError('name', 'contentMismatch', { type, detected: sniffed });
  }

  const svg = type === SVG ? await sanitizedSVG(stream) : undefined;
  const measured = mediaCategory(type) === 'image' ? imageSize(svg ?? head) : undefined;
  const source = isUndefined(svg) ? stream : bytesStream(svg);
  const declared = isUndefined(svg) ? size : svg.byteLength;

  const hash = createHash('sha256');
  let counted = 0;
  const metered = source.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        hash.update(chunk);
        counted += chunk.byteLength;
        controller.enqueue(chunk);
      },
    }),
  );
  const temp = `${TEMP_PREFIX}/${uuidv7()}`;
  await queryUntyped('UploadsJournal').unscoped().createOrThrow({
    sequence: null,
    op: 'stage',
    from: temp,
    to: null,
  });
  try {
    await useStorage().write(temp, metered, {
      type,
      size: declared,
      disposition: dispositionFor(type),
    });
  } catch (error) {
    await discardStaged(temp);
    throw error;
  }

  return {
    temp,
    size: counted,
    hash: hash.digest('hex'),
    width: measured?.width ?? null,
    height: measured?.height ?? null,
  };
}

/**
 * Claims the staged object `temp` for the row `tx` commits, so no sweep deletes it from then on.
 * Throws when `sweepStaged` claimed it first, since its bytes may already be gone.
 *
 * @example
 * ```ts
 * await useDatabase().transaction(async (tx) => {
 *   await claimStaged(tx, staged.temp)
 *   await journalStorage(tx, { op: 'move', from: staged.temp, to: 'photos/sunset.jpg' })
 * }, 'immediate')
 * ```
 */
export async function claimStaged(tx: Transaction, temp: string): Promise<void> {
  if (!(await release(tx, temp))) {
    throw ohneError(`Staged upload \`${temp}\` was swept before its row committed`);
  }
}

/**
 * Deletes the staged object `temp` and its `stage` entry, for an upload that failed before its row committed.
 * A failed delete keeps the entry for `sweepStaged` and never replaces the failure that led here.
 *
 * @example
 * ```ts
 * await discardStaged(staged.temp)
 * ```
 */
export async function discardStaged(temp: string): Promise<void> {
  try {
    await useStorage().delete(temp);
  } catch {
    return;
  }
  await queryUntyped('UploadsJournal').unscoped().where({ op: 'stage', from: temp }).delete();
}

/**
 * Deletes every staged object minted before `before`, a Unix-millisecond time, whose row never committed.
 * Each one is claimed and journaled as a `delete` in one transaction.
 * So a commit racing the sweep fails instead of keeping a row whose bytes are gone.
 * The drain then deletes the objects, and a failed delete waits for the next drain.
 *
 * @example
 * ```ts
 * await sweepStaged(Date.now() - 24 * 60 * 60 * 1000)
 * ```
 */
export async function sweepStaged(before: number): Promise<void> {
  const temps = (await queryUntyped('UploadsJournal')
    .unscoped()
    .where({ op: 'stage' })
    .pluck('from')) as string[];
  const stale = temps.filter((temp) => uuidv7Time(temp.slice(TEMP_PREFIX.length + 1)) < before);
  if (stale.length === 0) return;
  await useDatabase().transaction(async (tx) => {
    for (const temp of stale) {
      if (await release(tx, temp)) await journalStorage(tx, { op: 'delete', from: temp });
    }
  }, 'immediate');
  await drainJournal();
}

/**
 * Deletes the `stage` entry of `temp` on `tx`, resolving whether there was one to delete.
 */
async function release(tx: Transaction, temp: string): Promise<boolean> {
  const { deleted } = await queryUntyped('UploadsJournal')
    .use(tx)
    .unscoped()
    .where({ op: 'stage', from: temp })
    .delete();
  return deleted > 0;
}

/**
 * Reads up to `limit` bytes off the front of `body`, handing back the head and a stream carrying it all.
 */
async function peek(
  body: ReadableStream<Uint8Array>,
  limit: number,
): Promise<{ head: Uint8Array; stream: ReadableStream<Uint8Array> }> {
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  let ended = false;
  while (length < limit && !ended) {
    const { done, value } = await reader.read();
    if (done) ended = true;
    else {
      chunks.push(value);
      length += value.byteLength;
    }
  }
  const head = Buffer.concat(chunks).subarray(0, limit);
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk);
      if (ended) controller.close();
    },
    async pull(controller) {
      const { done, value } = await reader.read();
      if (done) controller.close();
      else controller.enqueue(value);
    },
    cancel: (reason) => reader.cancel(reason),
  });
  return { head, stream };
}

/**
 * Buffers an SVG body whole, up to `uploads.maxSVGSize`, and returns its sanitized markup as bytes.
 */
async function sanitizedSVG(stream: ReadableStream<Uint8Array>): Promise<Uint8Array> {
  const max = parseBytes(useUploadsConfig().maxSVGSize);
  const capped = limitStream(stream, max, () =>
    uploadsError('name', 'fileTooLarge', { max: formatBytes(max) }),
  );
  const bytes = await new Response(capped).bytes();
  let text: string;
  try {
    text = decodeText(bytes);
  } catch {
    throw uploadsError('name', 'notSVG');
  }
  const { svg } = sanitizeSVG(text);
  if (svg === '') throw uploadsError('name', 'notSVG');
  return new TextEncoder().encode(svg);
}

/**
 * A one-chunk stream over bytes already in memory.
 */
function bytesStream(bytes: Uint8Array): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(bytes);
      controller.close();
    },
  });
}
