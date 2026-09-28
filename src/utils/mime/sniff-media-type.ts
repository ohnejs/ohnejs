import { hasKey } from '../object/has-key.ts';

const SIGNATURES: readonly (readonly [magic: string, type: string, offset?: number])[] = [
  ['\x89PNG\r\n\x1a\n', 'image/png'],
  ['\xff\xd8\xff', 'image/jpeg'],
  ['GIF87a', 'image/gif'],
  ['GIF89a', 'image/gif'],
  ['\0\0\x01\0', 'image/x-icon'],
  ['II*\0', 'image/tiff'],
  ['MM\0*', 'image/tiff'],
  ['%PDF', 'application/pdf'],
  ['PK\x03\x04', 'application/zip'],
  ['\x1f\x8b', 'application/gzip'],
  ['7z\xbc\xaf\x27\x1c', 'application/x-7z-compressed'],
  ['Rar!\x1a\x07', 'application/vnd.rar'],
  ['ustar', 'application/x-tar', 257],
  ['ID3\x02', 'audio/mpeg'],
  ['ID3\x03', 'audio/mpeg'],
  ['ID3\x04', 'audio/mpeg'],
  ['fLaC', 'audio/flac'],
  ['OggS', 'application/ogg'],
  ['wOFF', 'font/woff'],
  ['wOF2', 'font/woff2'],
  ['\0\x01\0\0', 'font/ttf'],
  ['OTTO\0', 'font/otf'],
  ['\0asm', 'application/wasm'],
];

const RIFF_FORMS: Record<string, string> = {
  WEBP: 'image/webp',
  WAVE: 'audio/wav',
  'AVI ': 'video/x-msvideo',
};

const FTYP_BRANDS: Record<string, string> = {
  avif: 'image/avif',
  avis: 'image/avif',
  heic: 'image/heic',
  heix: 'image/heic',
  hevc: 'image/heic',
  hevx: 'image/heic',
  mif1: 'image/heif',
  msf1: 'image/heif',
  isom: 'video/mp4',
  iso2: 'video/mp4',
  mp41: 'video/mp4',
  mp42: 'video/mp4',
  avc1: 'video/mp4',
  'M4V ': 'video/x-m4v',
  'M4A ': 'audio/mp4',
  'qt  ': 'video/quicktime',
};

const DIB_HEADER_SIZES = [12, 16, 40, 52, 56, 64, 108, 124];

const EBML_HEADER = '\x1a\x45\xdf\xa3';

const EBML_DOCTYPE = '\x42\x82';

const EBML_DOCTYPES: Record<string, string> = {
  webm: 'video/webm',
  matroska: 'video/x-matroska',
};

const TEXT_HEAD = 4096;

const XML_PROLOGUE = /^(?:\s+|<\?.*?\?>|<!--.*?-->|<!(?:[^>[]|\[[^\]]*\])*>)*/s;

const SVG_ROOT = /^<svg[\s/>]/;

const decoder = new TextDecoder();

/**
 * Reads `length` bytes at `offset` as a Latin-1 string, one character per byte.
 * A header shorter than the window yields a shorter string.
 */
function latin1(bytes: Uint8Array, offset: number, length: number): string {
  return String.fromCharCode(...bytes.subarray(offset, offset + length));
}

/**
 * Reports whether `bytes` carries `magic` at `offset`.
 */
function matches(bytes: Uint8Array, offset: number, magic: string): boolean {
  return latin1(bytes, offset, magic.length) === magic;
}

/**
 * Looks `key` up in a signature table without touching inherited names.
 */
function lookup(table: Record<string, string>, key: string): string | undefined {
  return hasKey(table, key) ? table[key] : undefined;
}

/**
 * Resolves a Matroska-family type from the `DocType` element of the EBML header.
 */
function ebmlType(bytes: Uint8Array): string | undefined {
  const header = latin1(bytes, 0, 64);
  const at = header.indexOf(EBML_DOCTYPE);
  if (at === -1) return undefined;
  const length = header.charCodeAt(at + 2) & 0x7f;
  return lookup(EBML_DOCTYPES, header.slice(at + 3, at + 3 + length));
}

/**
 * Reports whether `bytes` opens a BMP: `BM`, then a known DIB header size at byte 14.
 * The size keeps text that opens with `BM`, such as a CSV of `BMI` values, from passing as a bitmap.
 */
function isBMP(bytes: Uint8Array): boolean {
  return (
    matches(bytes, 0, 'BM') && DIB_HEADER_SIZES.includes(bytes[14]) && matches(bytes, 15, '\0\0\0')
  );
}

/**
 * Reports whether `bytes` opens with an MPEG audio frame header: sync bits, layer III, a valid version.
 * Layers I and II are left alone; their sync pattern also opens a UTF-16 text file.
 */
function isMP3Frame(bytes: Uint8Array): boolean {
  return bytes[0] === 0xff && (bytes[1] & 0xe6) === 0xe2 && (bytes[1] & 0x18) !== 0x08;
}

/**
 * Reports whether `bytes` is an SVG document, an `<svg` root after the XML prologue.
 * The decoder drops a BOM; the prologue is whitespace, the XML declaration, comments, and a DOCTYPE.
 */
function isSVG(bytes: Uint8Array): boolean {
  const head = decoder.decode(bytes.subarray(0, TEXT_HEAD));
  return SVG_ROOT.test(head.replace(XML_PROLOGUE, ''));
}

/**
 * Sniffs the media type of a file from its leading bytes, using a curated table of signatures.
 * Covers the common image, video, audio, font, archive, and document formats plus SVG and WebAssembly.
 * Returns `undefined` when no signature matches, so the caller falls back to the file's extension.
 *
 * Plain text formats have no signature and are never sniffed; SVG alone is recognised, by its `<svg` root.
 * A container hides what it holds, so the container is returned: `application/zip` for a `.docx`.
 * Never throws; an empty or truncated header is simply unrecognised.
 *
 * @example
 * ```ts
 * sniffMediaType(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
 * // -> 'image/png'
 *
 * sniffMediaType(new TextEncoder().encode('%PDF-1.7'))
 * // -> 'application/pdf'
 *
 * sniffMediaType(new TextEncoder().encode('hello'))
 * // -> undefined
 * ```
 */
export function sniffMediaType(bytes: Uint8Array): string | undefined {
  if (matches(bytes, 4, 'ftyp')) return lookup(FTYP_BRANDS, latin1(bytes, 8, 4));
  if (matches(bytes, 0, 'RIFF')) return lookup(RIFF_FORMS, latin1(bytes, 8, 4));
  if (matches(bytes, 0, EBML_HEADER)) return ebmlType(bytes);
  for (const [magic, type, offset = 0] of SIGNATURES) {
    if (matches(bytes, offset, magic)) return type;
  }
  if (isBMP(bytes)) return 'image/bmp';
  if (isMP3Frame(bytes)) return 'audio/mpeg';
  if (isSVG(bytes)) return 'image/svg+xml';
  return undefined;
}
