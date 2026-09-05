import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import {
  decodeText,
  imageSize,
  isUndefined,
  mediaCategory,
  mediaTypesCompatible,
  sanitizeSVG,
  sniffMediaType,
  uuidv7,
} from 'ohne/utils';

import { useStorage } from '../storage/use-storages.ts';
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
 * The bytes then flow through a sha256 counter into `storage.write` under the `.tmp/` prefix.
 * `size` is the request's declared length, a hint for a backend that needs it up front.
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
  await useStorage().write(temp, metered, { type, size: declared });

  return {
    temp,
    size: counted,
    hash: hash.digest('hex'),
    width: measured?.width ?? null,
    height: measured?.height ?? null,
  };
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
 * Buffers an SVG body whole and returns its sanitized markup as bytes.
 */
async function sanitizedSVG(stream: ReadableStream<Uint8Array>): Promise<Uint8Array> {
  const bytes = await new Response(stream).bytes();
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
