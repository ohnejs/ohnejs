import { useEnv } from 'ohne';
import { hmac, secureCompare } from 'ohne/utils/crypto';

/**
 * The secrets `IMAGES_SECRET` lists, comma-separated, trimmed, empty entries dropped.
 * The first one signs; a service accepts any, which is how a rotation happens without breaking pages.
 * `[]` when the env var is unset.
 */
export function imageSecrets(): string[] {
  return (useEnv().get('IMAGES_SECRET') ?? '')
    .split(',')
    .map((secret) => secret.trim())
    .filter(Boolean);
}

/**
 * Signs a variant: base64url HMAC-SHA256 over `{transforms}/{path}` under `secret`.
 * The signed string is the raw one a service receives, so the service verifies before it parses.
 *
 * @example
 * ```ts
 * signImageVariant('w_800,f_webp', 'photos/sunset.jpg', 'secret')
 * // -> '2ObrtBfM78cHtN36wuvyNQXgSGGcr4cZtUQeqAhJyck'
 * ```
 */
export function signImageVariant(transforms: string, path: string, secret: string): string {
  return hmac(`${transforms}/${path}`, secret);
}

/**
 * Whether `signature` is the signature of the variant under any of `secrets`.
 * Compares in constant time, so a service can call it on untrusted input.
 *
 * @example
 * ```ts
 * const signature = signImageVariant('w_800', 'a.jpg', 'old')
 *
 * verifyImageVariant(signature, 'w_800', 'a.jpg', ['new', 'old']) // -> true
 * verifyImageVariant(signature, 'w_800', 'a.jpg', ['new'])        // -> false
 * ```
 */
export function verifyImageVariant(
  signature: string,
  transforms: string,
  path: string,
  secrets: readonly string[],
): boolean {
  return secrets.some((secret) =>
    secureCompare(signature, signImageVariant(transforms, path, secret)),
  );
}
