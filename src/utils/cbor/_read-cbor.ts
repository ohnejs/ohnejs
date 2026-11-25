import type { CBORMap, CBORValue } from './decode-cbor.ts';

import { isBigInt } from '../is/is-bigint.ts';
import { isInteger } from '../is/is-integer.ts';
import { isString } from '../is/is-string.ts';
import { decodeText } from '../text/decode-text.ts';

/**
 * A decoded item and the offset just past it.
 */
export interface CBORItem {
  value: CBORValue;
  end: number;
}

/**
 * Reads the one CBOR item at `offset` in `bytes`, allowing bytes after it.
 */
export function readCBOR(bytes: Uint8Array, offset: number, maxDepth: number): CBORItem {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let at = offset;

  const take = (length: number): number => {
    if (length > bytes.byteLength - at) throw new Error('CBOR data ends early');
    const start = at;
    at += length;
    return start;
  };

  const argument = (info: number): number | bigint => {
    if (info < 24) return info;
    if (info === 24) return view.getUint8(take(1));
    if (info === 25) return view.getUint16(take(2));
    if (info === 26) return view.getUint32(take(4));
    if (info === 27) {
      const value = view.getBigUint64(take(8));
      return value <= Number.MAX_SAFE_INTEGER ? Number(value) : value;
    }
    if (info === 31) throw new Error('CBOR indefinite lengths are not supported');
    throw new Error(`Invalid CBOR additional info \`${info}\``);
  };

  const length = (info: number, unit: number): number => {
    const count = argument(info);
    if (isBigInt(count) || count * unit > bytes.byteLength - at) {
      throw new Error('CBOR length exceeds the data');
    }
    return count;
  };

  const item = (depth: number): CBORValue => {
    if (depth > maxDepth) throw new Error(`CBOR nests deeper than \`${maxDepth}\``);
    const initial = view.getUint8(take(1));
    const major = initial >> 5;
    const info = initial & 0x1f;

    switch (major) {
      case 0:
        return argument(info);
      case 1: {
        const value = argument(info);
        return isBigInt(value) || value === Number.MAX_SAFE_INTEGER
          ? -1n - BigInt(value)
          : -1 - value;
      }
      case 2:
        return bytes.slice(take(length(info, 1)), at);
      case 3:
        return decodeText(bytes.subarray(take(length(info, 1)), at), { keepBOM: true });
      case 4:
        return Array.from({ length: length(info, 1) }, () => item(depth + 1));
      case 5: {
        const map: CBORMap = new Map();
        for (let i = length(info, 2); i > 0; i--) {
          const key = item(depth + 1);
          if (!isString(key) && !isInteger(key)) {
            throw new Error('CBOR map keys must be integers or text');
          }
          if (map.has(key)) throw new Error(`Duplicate CBOR map key \`${key}\``);
          map.set(key, item(depth + 1));
        }
        return map;
      }
      case 7:
        return simple(info);
      default:
        throw new Error('CBOR tags are not supported');
    }
  };

  const simple = (info: number): CBORValue => {
    if (info === 20) return false;
    if (info === 21) return true;
    if (info === 22) return null;
    if (info === 23) return undefined;
    if (info === 25) return view.getFloat16(take(2));
    if (info === 26) return view.getFloat32(take(4));
    if (info === 27) return view.getFloat64(take(8));
    if (info === 31) throw new Error('CBOR indefinite lengths are not supported');
    throw new Error(`Unsupported CBOR simple value \`${info}\``);
  };

  const value = item(0);
  return { value, end: at };
}
