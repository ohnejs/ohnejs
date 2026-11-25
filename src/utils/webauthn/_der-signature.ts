/**
 * Converts a DER `ECDSA-Sig-Value` into the fixed-width `r || s` form WebCrypto verifies.
 * `size` is the curve's byte length, such as `32` for P-256.
 */
export function derToP1363(der: Uint8Array, size: number): Uint8Array<ArrayBuffer> {
  if (der[0] !== 0x30 || der[1] !== der.byteLength - 2) throw new Error('Invalid DER signature');
  const out = new Uint8Array(size * 2);
  let at = 2;
  for (const half of [0, 1]) {
    const length = der[at + 1];
    const end = at + 2 + length;
    if (der[at] !== 0x02 || length === 0 || end > der.byteLength) {
      throw new Error('Invalid DER signature');
    }
    const integer = der.subarray(at + 2, end);
    const negative = (integer[0] & 0x80) !== 0;
    const padded = length > 1 && integer[0] === 0 && (integer[1] & 0x80) === 0;
    const value = integer[0] === 0 ? integer.subarray(1) : integer;
    if (negative || padded || value.byteLength > size) throw new Error('Invalid DER signature');
    out.set(value, half * size + size - value.byteLength);
    at = end;
  }
  if (at !== der.byteLength) throw new Error('Invalid DER signature');
  return out;
}
