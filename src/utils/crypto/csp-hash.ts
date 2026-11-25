import { digest } from './digest.ts';

/**
 * The `script-src` or `style-src` source that allows one inline script or style by its SHA-256.
 * The hash covers `text` exactly as it sits between the tags, whitespace included.
 *
 * @example
 * ```ts
 * cspHash('')          // -> "'sha256-47DEQpj8HBSa+/TImW+5JCeuQeRkm5NMpJWZG3hSuFU='"
 * cspHash('alert(1);') // -> "'sha256-5jFwrAK0UV47oFbVg/iCCBbxD8X1w+QvoOUepu4C2YA='"
 * ```
 */
export function cspHash(text: string): string {
  return `'sha256-${digest('sha256', text).toBase64()}'`;
}
