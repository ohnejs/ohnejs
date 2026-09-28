import { isNull } from '../is/is-null.ts';
import { isRealNumber } from '../is/is-real-number.ts';
import { isUndefined } from '../is/is-undefined.ts';

/**
 * The pixel size and media type of an image, read from its header by `imageSize`.
 */
export interface ImageSize {
  /**
   * The displayed width in pixels.
   * A JPEG honors its EXIF orientation, so the size matches what a browser shows.
   */
  width: number;

  /**
   * The displayed height in pixels.
   */
  height: number;

  /**
   * The media type the header identifies (`'image/png'`, `'image/svg+xml'`, ...).
   */
  type: string;
}

/**
 * The `[start, end)` byte range of an ISOBMFF box payload.
 */
type Bounds = [start: number, end: number];

const BRAND_TYPES: Record<string, string> = {
  avif: 'image/avif',
  avis: 'image/avif',
  heic: 'image/heic',
  heix: 'image/heic',
  heif: 'image/heif',
  mif1: 'image/heif',
};

// Each prologue body stops at its own terminator, so a run of them cannot backtrack exponentially.
const SVG_ROOT_RE =
  /^\s*(?:(?:<\?(?:[^?]|\?(?!>))*\?>|<!--(?:[^-]|-(?!->))*-->|<!(?!--)(?:[^>[]|\[[^\]]*\])*>)\s*)*<svg(?=[\s/>])((?:[^>"']|"[^"]*"|'[^']*')*)>/;
const SVG_ATTRIBUTE_RE = /\s([^\s=]+)\s*=\s*(["'])(.*?)\2/gs;
const SVG_LENGTH_RE = /^\s*([+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?)(?:px)?\s*$/i;

const SVG_HEAD = 64 * 1024;

const decoder = new TextDecoder();

/**
 * Reads the pixel size and media type of an image from the leading bytes of its file.
 * Supports PNG, JPEG, GIF, WebP, AVIF, HEIC, HEIF, and SVG.
 * Returns `undefined` when the bytes are not a supported image or end before the size is stored.
 *
 * Only the header is read, so the first few KiB of a stream are enough for most files.
 * A JPEG with an EXIF orientation of `5` to `8` reports the swapped size, matching what a browser displays.
 * A HEIF reports its primary item, so a tiled HEIC gives the full image and not a tile.
 * An SVG is sized by `width` and `height` in `px` or unitless, else by its `viewBox`.
 * A percentage or a length that is not positive defers to the `viewBox`; any other unit means no answer.
 * Malformed input never throws.
 *
 * @example
 * ```ts
 * imageSize(await readFile('photo.png'))
 * // -> { width: 640, height: 480, type: 'image/png' }
 *
 * imageSize(new TextEncoder().encode('<svg viewBox="0 0 24 24"/>'))
 * // -> { width: 24, height: 24, type: 'image/svg+xml' }
 *
 * imageSize(new Uint8Array([1, 2, 3]))
 * // -> undefined
 * ```
 */
export function imageSize(bytes: Uint8Array): ImageSize | undefined {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (matches(view, 0, '\x89PNG\r\n\x1a\n')) return readPNG(view);
  if (matches(view, 0, '\xff\xd8')) return readJPEG(view);
  if (matches(view, 0, 'GIF87a') || matches(view, 0, 'GIF89a')) return readGIF(view);
  if (matches(view, 0, 'RIFF') && matches(view, 8, 'WEBP')) return readWebP(view);
  if (matches(view, 4, 'ftyp')) return readISOBMFF(view);
  return readSVG(bytes);
}

/**
 * Tests whether the bytes at `offset` spell `text`, one byte per character.
 */
function matches(view: DataView, offset: number, text: string): boolean {
  if (offset + text.length > view.byteLength) return false;
  for (let i = 0; i < text.length; i++) {
    if (view.getUint8(offset + i) !== text.charCodeAt(i)) return false;
  }
  return true;
}

/**
 * Reads the `IHDR` chunk that opens every PNG.
 */
function readPNG(view: DataView): ImageSize | undefined {
  if (view.byteLength < 24 || !matches(view, 12, 'IHDR')) return undefined;
  return { width: view.getUint32(16), height: view.getUint32(20), type: 'image/png' };
}

/**
 * Reads the logical screen descriptor that follows the GIF signature.
 */
function readGIF(view: DataView): ImageSize | undefined {
  if (view.byteLength < 10) return undefined;
  return { width: view.getUint16(6, true), height: view.getUint16(8, true), type: 'image/gif' };
}

/**
 * Reads the first RIFF chunk of a WebP: a `VP8 ` key frame, a `VP8L` header, or a `VP8X` canvas.
 */
function readWebP(view: DataView): ImageSize | undefined {
  const type = 'image/webp';
  if (view.byteLength >= 30 && matches(view, 12, 'VP8 ') && matches(view, 23, '\x9d\x01\x2a')) {
    const width = view.getUint16(26, true) & 0x3fff;
    const height = view.getUint16(28, true) & 0x3fff;
    return { width, height, type };
  }
  if (view.byteLength >= 25 && matches(view, 12, 'VP8L') && matches(view, 20, '\x2f')) {
    const bits = view.getUint32(21, true);
    return { width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1, type };
  }
  if (view.byteLength >= 30 && matches(view, 12, 'VP8X')) {
    return { width: uint24(view, 24) + 1, height: uint24(view, 27) + 1, type };
  }
  return undefined;
}

/**
 * Reads a little-endian 24-bit integer.
 */
function uint24(view: DataView, offset: number): number {
  return view.getUint16(offset, true) | (view.getUint8(offset + 2) << 16);
}

/**
 * Walks the marker segments to the first frame header, honoring an EXIF orientation met on the way.
 */
function readJPEG(view: DataView): ImageSize | undefined {
  let orientation = 1;
  let offset = 2;
  while (offset + 4 <= view.byteLength) {
    if (view.getUint8(offset) !== 0xff) return undefined;
    const marker = view.getUint8(offset + 1);
    if (marker === 0xff) {
      offset += 1;
      continue;
    }
    if (isStandaloneMarker(marker)) {
      offset += 2;
      continue;
    }
    if (marker === 0xd9 || marker === 0xda) return undefined;
    const length = view.getUint16(offset + 2);
    if (length < 2) return undefined;
    if (isFrameMarker(marker)) {
      if (offset + 9 > view.byteLength) return undefined;
      const height = view.getUint16(offset + 5);
      const width = view.getUint16(offset + 7);
      // A zero height defers the line count to a DNL marker after the first scan.
      if (height === 0) return undefined;
      const swap = orientation >= 5 && orientation <= 8;
      return { width: swap ? height : width, height: swap ? width : height, type: 'image/jpeg' };
    }
    const end = Math.min(offset + 2 + length, view.byteLength);
    if (marker === 0xe1) orientation = exifOrientation(view, offset + 4, end) ?? orientation;
    offset += 2 + length;
  }
  return undefined;
}

/**
 * `TEM`, `RST0` to `RST7`, and `SOI`: markers that carry no length or payload.
 */
function isStandaloneMarker(marker: number): boolean {
  return marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8);
}

/**
 * `SOF0` to `SOF15`, minus the three codes in that range that are not frame headers: `DHT`, `JPG`, `DAC`.
 */
function isFrameMarker(marker: number): boolean {
  return marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
}

/**
 * Reads the `Orientation` tag from an EXIF `APP1` payload's IFD0, or `undefined` when there is none.
 */
function exifOrientation(view: DataView, start: number, end: number): number | undefined {
  if (start + 14 > end || !matches(view, start, 'Exif\0\0')) return undefined;
  const tiff = start + 6;
  const little = matches(view, tiff, 'II');
  if (!little && !matches(view, tiff, 'MM')) return undefined;
  const ifd = tiff + view.getUint32(tiff + 4, little);
  if (ifd + 2 > end) return undefined;
  const count = view.getUint16(ifd, little);
  for (let i = 0; i < count; i++) {
    const entry = ifd + 2 + i * 12;
    if (entry + 12 > end) return undefined;
    if (view.getUint16(entry, little) === 0x0112) return view.getUint16(entry + 8, little);
  }
  return undefined;
}

/**
 * Reads the brand from `ftyp`, then the `ispe` of the primary item under `meta/iprp/ipco`.
 * Without a `pitm` and `ipma` that resolve the primary item, the first `ispe` stands in.
 */
function readISOBMFF(view: DataView): ImageSize | undefined {
  const file: Bounds = [0, view.byteLength];
  const ftyp = findBox(view, file, 'ftyp');
  const type = ftyp && brandType(view, ftyp);
  const meta = findBox(view, file, 'meta');
  if (isUndefined(type) || isUndefined(meta)) return undefined;
  const metaBody: Bounds = [meta[0] + 4, meta[1]];
  const iprp = findBox(view, metaBody, 'iprp');
  const ipco = iprp && findBox(view, iprp, 'ipco');
  if (isUndefined(iprp) || isUndefined(ipco)) return undefined;
  const ispe = primaryISPE(view, metaBody, iprp, ipco) ?? findBox(view, ipco, 'ispe');
  if (isUndefined(ispe) || ispe[0] + 12 > ispe[1]) return undefined;
  return { width: view.getUint32(ispe[0] + 4), height: view.getUint32(ispe[0] + 8), type };
}

/**
 * Maps the major brand, then the compatible brands, of an `ftyp` payload to a media type.
 * `BRAND_TYPES` order sets the priority, so an AVIF listing `mif1` stays AVIF.
 */
function brandType(view: DataView, [start, end]: Bounds): string | undefined {
  for (const [brand, type] of Object.entries(BRAND_TYPES)) {
    if (matches(view, start, brand)) return type;
    for (let offset = start + 8; offset + 4 <= end; offset += 4) {
      if (matches(view, offset, brand)) return type;
    }
  }
  return undefined;
}

/**
 * The `ispe` of the primary item: its ID from `pitm`, its property indices from `ipma`, the box from `ipco`.
 * Returns `undefined` when either box is missing or none of the item's properties is an `ispe`.
 */
function primaryISPE(
  view: DataView,
  metaBody: Bounds,
  iprp: Bounds,
  ipco: Bounds,
): Bounds | undefined {
  const pitm = findBox(view, metaBody, 'pitm');
  const ipma = findBox(view, iprp, 'ipma');
  const item = pitm && primaryItem(view, pitm);
  if (isUndefined(item) || isUndefined(ipma)) return undefined;
  const indices = new Set(itemProperties(view, ipma, item));
  let index = 0;
  for (const [type, bounds] of boxes(view, ipco)) {
    if (indices.has(++index) && type === 'ispe') return bounds;
  }
  return undefined;
}

/**
 * The item ID stored in a `pitm` payload: 16 bits in version 0, 32 bits from version 1 on.
 */
function primaryItem(view: DataView, [start, end]: Bounds): number | undefined {
  if (start + 6 > end) return undefined;
  const wide = view.getUint8(start) !== 0;
  if (wide && start + 8 > end) return undefined;
  return wide ? view.getUint32(start + 4) : view.getUint16(start + 4);
}

/**
 * The 1-based `ipco` indices that an `ipma` payload associates with `item`, in the order listed.
 * Version 1 widens item IDs to 32 bits; flag bit 0 widens each index from 7 to 15 bits.
 */
function* itemProperties(view: DataView, [start, end]: Bounds, item: number): Generator<number> {
  if (start + 8 > end) return;
  const wide = view.getUint8(start) !== 0;
  const width = view.getUint8(start + 3) & 1 ? 2 : 1;
  const entries = view.getUint32(start + 4);
  let offset = start + 8;
  for (let i = 0; i < entries && offset + (wide ? 5 : 3) <= end; i++) {
    const id = wide ? view.getUint32(offset) : view.getUint16(offset);
    offset += wide ? 4 : 2;
    const count = view.getUint8(offset++);
    if (id !== item) {
      offset += count * width;
      continue;
    }
    for (let j = 0; j < count && offset + width <= end; j++, offset += width) {
      yield width === 1 ? view.getUint8(offset) & 0x7f : view.getUint16(offset) & 0x7fff;
    }
    return;
  }
}

/**
 * The payload bounds of the first box of `type` among the siblings in `bounds`.
 */
function findBox(view: DataView, bounds: Bounds, type: string): Bounds | undefined {
  for (const [name, payload] of boxes(view, bounds)) {
    if (name === type) return payload;
  }
  return undefined;
}

/**
 * Walks the sibling boxes in `bounds`, yielding each box's type and payload bounds.
 * A size of `1` reads the 64-bit size that follows; a size of `0` runs to the end.
 */
function* boxes(view: DataView, [start, end]: Bounds): Generator<[string, Bounds]> {
  let offset = start;
  while (offset + 8 <= end) {
    let size = view.getUint32(offset);
    let header = 8;
    if (size === 1) {
      if (offset + 16 > end) return;
      size = Number(view.getBigUint64(offset + 8));
      header = 16;
    }
    if (size === 0) size = end - offset;
    if (size < header) return;
    yield [boxType(view, offset + 4), [offset + header, Math.min(offset + size, end)]];
    offset += size;
  }
}

/**
 * The four-character box type stored at `offset`.
 */
function boxType(view: DataView, offset: number): string {
  return String.fromCharCode(...new Uint8Array(view.buffer, view.byteOffset + offset, 4));
}

/**
 * Sizes an SVG by the root `<svg>` tag, found past any XML declaration, doctype, or comment.
 * Only the first 64 KiB are decoded, so an unrecognised large file never becomes a string whole.
 */
function readSVG(bytes: Uint8Array): ImageSize | undefined {
  const root = SVG_ROOT_RE.exec(decoder.decode(bytes.subarray(0, SVG_HEAD)));
  if (isNull(root)) return undefined;
  const attributes = new Map<string, string>();
  for (const [, name, , value] of root[1].matchAll(SVG_ATTRIBUTE_RE)) attributes.set(name, value);
  const type = 'image/svg+xml';
  const width = svgLength(attributes.get('width'));
  const height = svgLength(attributes.get('height'));
  if (Number.isNaN(width) || Number.isNaN(height)) return undefined;
  if (!isUndefined(width) && !isUndefined(height)) return { width, height, type };
  const box = svgViewBox(attributes.get('viewBox'));
  return box && { width: box[0], height: box[1], type };
}

/**
 * The positive width and height of a `viewBox`, or `undefined` when it is absent or malformed.
 */
function svgViewBox(value: string | undefined): [number, number] | undefined {
  const parts = (value?.match(/[^\s,]+/g) ?? []).map(Number);
  const [, , width, height] = parts;
  if (parts.length !== 4 || !isRealNumber(width) || !isRealNumber(height)) return undefined;
  return width > 0 && height > 0 ? [width, height] : undefined;
}

/**
 * A positive `px` or unitless length as a number, `NaN` for any other unit.
 * `undefined` when absent, a percentage, or not positive: the cases the `viewBox` decides.
 */
function svgLength(value: string | undefined): number | undefined {
  if (isUndefined(value) || value.trim().endsWith('%')) return undefined;
  const match = SVG_LENGTH_RE.exec(value);
  if (isNull(match)) return NaN;
  const length = Number(match[1]);
  return length > 0 ? length : undefined;
}
