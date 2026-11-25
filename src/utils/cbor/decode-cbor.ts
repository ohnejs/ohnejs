import { readCBOR } from './_read-cbor.ts';

/**
 * A value `decodeCBOR` returns.
 * An integer beyond the safe range is a `bigint`, a byte string a `Uint8Array`, a map a `Map`.
 */
export type CBORValue =
  | number
  | bigint
  | string
  | boolean
  | null
  | undefined
  | Uint8Array
  | CBORValue[]
  | CBORMap;

/**
 * A CBOR map, keyed by integers or text.
 */
export type CBORMap = Map<string | number, CBORValue>;

/**
 * Options for `decodeCBOR`.
 */
export interface DecodeCBOROptions {
  /**
   * How deep arrays and maps may nest.
   *
   * @default
   * 16
   */
  maxDepth?: number;
}

/**
 * Decodes one RFC 8949 CBOR item that spans all of `bytes`.
 * Covers what WebAuthn and COSE need: integers, byte and text strings, arrays, maps, simple values, floats.
 * Map keys must be integers or text, and appear once.
 *
 * Tags, indefinite lengths, trailing bytes, and a length longer than the data all throw.
 *
 * @example
 * ```ts
 * decodeCBOR(Uint8Array.fromHex('1903e8'))       // -> 1000
 * decodeCBOR(Uint8Array.fromHex('83010203'))     // -> [1, 2, 3]
 * decodeCBOR(Uint8Array.fromHex('a2616101200a')) // -> Map { 'a' => 1, -1 => 10 }
 * decodeCBOR(Uint8Array.fromHex('9f01ff'))       // -> throws, indefinite length
 * ```
 */
export function decodeCBOR(bytes: Uint8Array, options: DecodeCBOROptions = {}): CBORValue {
  const { value, end } = readCBOR(bytes, 0, options.maxDepth ?? 16);
  if (end !== bytes.byteLength) throw new Error('Trailing bytes after the CBOR item');
  return value;
}
