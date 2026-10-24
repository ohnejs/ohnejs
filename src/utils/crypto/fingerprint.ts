import { digest } from './digest.ts';

/**
 * A short, URL-safe fingerprint of `data`: the first 48 bits of its SHA-256 as 8 base64url characters.
 * Use it to name content in a URL, so the name changes whenever the bytes do.
 * A string and its UTF-8 bytes share one fingerprint.
 *
 * @example
 * ```ts
 * fingerprint('')                      // -> '47DEQpj8'
 * fingerprint('export const a = 1;\n') // -> 'A37NHbOM'
 * ```
 */
export function fingerprint(data: string | Uint8Array): string {
  return digest('sha256', data).toBase64({ alphabet: 'base64url', omitPadding: true }).slice(0, 8);
}
