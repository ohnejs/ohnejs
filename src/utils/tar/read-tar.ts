import { codeSpan } from '../ansi/code-span.ts';

/**
 * One file or directory of a tar archive.
 */
export interface TarEntry {
  /**
   * The entry's path inside the archive, with `/` separators and no trailing `/`.
   */
  path: string;

  /**
   * Whether the entry is a file or a directory.
   */
  type: 'file' | 'directory';

  /**
   * The file's bytes, empty for a directory.
   */
  data: Uint8Array;
}

const BLOCK = 512;

const FILE_TYPES = new Set(['0', '\0', '7']);

const decoder = new TextDecoder();

/**
 * Reads the files and directories of an uncompressed tar archive.
 * It reads ustar names with their `prefix` and pax `path` records, so long paths survive.
 * A pax global header is skipped, as GitHub's archives start with one.
 * A link, a device, an absolute path, a `..` segment, a bad checksum, or a truncated archive throws.
 *
 * @example
 * ```ts
 * readTar(bytes) // -> [{ path: 'repo-1/README.md', type: 'file', data: Uint8Array(42) }]
 * ```
 */
export function readTar(bytes: Uint8Array): TarEntry[] {
  const entries: TarEntry[] = [];
  let pax = new Map<string, string>();
  let offset = 0;
  while (offset + BLOCK <= bytes.length) {
    const header = bytes.subarray(offset, offset + BLOCK);
    if (header.every((byte) => byte === 0)) return entries;
    if (checksum(header) !== octal(header, 148, 8)) throw new Error('Tar header checksum mismatch');

    const type = String.fromCharCode(header[156]!);
    const extended = type === 'x' || type === 'g';
    const size = extended || !pax.has('size') ? octal(header, 124, 12) : paxSize(pax.get('size')!);
    const start = offset + BLOCK;
    if (start + size > bytes.length) break;
    const data = bytes.subarray(start, start + size);
    offset = start + Math.ceil(size / BLOCK) * BLOCK;

    if (type === 'x') pax = paxRecords(data);
    if (extended) continue;
    const path = entryPath(pax.get('path') ?? ustarPath(header));
    pax = new Map();
    if (type !== '5' && !FILE_TYPES.has(type)) {
      throw new Error(`Tar entry ${codeSpan(path)} has unsupported type ${codeSpan(type)}`);
    }
    entries.push(
      type === '5'
        ? { path, type: 'directory', data: new Uint8Array(0) }
        : { path, type: 'file', data },
    );
  }
  throw new Error('Truncated tar archive');
}

/**
 * The header's checksum: the sum of its bytes, with the checksum field read as spaces.
 */
function checksum(header: Uint8Array): number {
  let sum = 0;
  for (let i = 0; i < BLOCK; i++) sum += i >= 148 && i < 156 ? 0x20 : header[i]!;
  return sum;
}

/**
 * The octal number in the header field at `start`, `length` bytes long.
 */
function octal(header: Uint8Array, start: number, length: number): number {
  const text = cString(header, start, length).trim();
  if (!/^[0-7]*$/.test(text)) throw new Error(`Tar header field ${codeSpan(text)} is not octal`);
  return text === '' ? 0 : Number.parseInt(text, 8);
}

/**
 * The NUL-terminated text in the header field at `start`, `length` bytes long.
 */
function cString(header: Uint8Array, start: number, length: number): string {
  const field = header.subarray(start, start + length);
  const end = field.indexOf(0);
  return decoder.decode(end === -1 ? field : field.subarray(0, end));
}

/**
 * The ustar path: `prefix` and `name` joined, where the magic says the header has a `prefix`.
 */
function ustarPath(header: Uint8Array): string {
  const name = cString(header, 0, 100);
  const ustar = decoder.decode(header.subarray(257, 263)) === 'ustar\0';
  const prefix = ustar ? cString(header, 345, 155) : '';
  return prefix ? `${prefix}/${name}` : name;
}

/**
 * The records of a pax extended header, each `<length> <key>=<value>\n`.
 */
function paxRecords(data: Uint8Array): Map<string, string> {
  const records = new Map<string, string>();
  let at = 0;
  while (at < data.length) {
    const space = data.indexOf(0x20, at);
    const digits = space === -1 ? '' : decoder.decode(data.subarray(at, space));
    const end = at + Number(digits);
    if (!/^\d+$/.test(digits) || end <= space + 1 || end > data.length || data[end - 1] !== 0x0a) {
      throw new Error('Malformed pax header');
    }
    const record = decoder.decode(data.subarray(space + 1, end - 1));
    const equals = record.indexOf('=');
    if (equals === -1) throw new Error('Malformed pax header');
    records.set(record.slice(0, equals), record.slice(equals + 1));
    at = end;
  }
  return records;
}

/**
 * The decimal size a pax `size` record holds.
 */
function paxSize(value: string): number {
  if (!/^\d+$/.test(value)) throw new Error(`Pax size ${codeSpan(value)} is not a number`);
  return Number(value);
}

/**
 * The entry path without its trailing `/`, refused when it is empty, absolute, or climbs with `..`.
 */
function entryPath(raw: string): string {
  const path = raw.replace(/\/+$/, '');
  const unsafe =
    path === '' ||
    path.includes('\0') ||
    /^(?:[\\/]|[A-Za-z]:)/.test(path) ||
    path.split(/[\\/]/).includes('..');
  if (unsafe) throw new Error(`Tar entry path ${codeSpan(raw)} is unsafe`);
  return path;
}
