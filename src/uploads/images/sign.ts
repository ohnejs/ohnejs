import { useEnv } from 'ohnejs';
import { isEmpty } from 'ohnejs/utils';
import { hmac, secureCompare } from 'ohnejs/utils/crypto';

/**
 * The signature segment `imageURL` writes when no `UPLOADS_SECRET` is set.
 * A service started unsigned renders it; a signing service answers `403`.
 */
export const UNSIGNED_SIGNATURE = 'unsigned';

/**
 * The secrets `UPLOADS_SECRET` lists, comma-separated, trimmed, empty entries dropped.
 * They sign image variant URLs and the links of private files alike.
 * The first one signs; any verifies, which is how a rotation happens without breaking pages.
 * `[]` when the env var is unset.
 */
export function uploadSecrets(): string[] {
  return (useEnv().get('UPLOADS_SECRET') ?? '')
    .split(',')
    .map((secret) => secret.trim())
    .filter(Boolean);
}

/**
 * Whether `UPLOADS_SECRET` names a secret, so variant URLs and private-file links can be signed.
 * Without one a public variant reads `unsigned`, and a private file has no links and no variants.
 */
export function hasUploadSecret(): boolean {
  return !isEmpty(uploadSecrets());
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
