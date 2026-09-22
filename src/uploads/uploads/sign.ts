import { useEnv } from 'ohnejs';

import { signImageVariant, verifyImageVariant } from '../images/sign.ts';

/**
 * The secrets `UPLOADS_SECRET` lists, comma-separated, trimmed, empty entries dropped.
 * The first one signs; any verifies, which is how a rotation happens without breaking links.
 * `[]` when the env var is unset.
 */
export function uploadSecrets(): string[] {
  return (useEnv().get('UPLOADS_SECRET') ?? '')
    .split(',')
    .map((secret) => secret.trim())
    .filter(Boolean);
}

/**
 * Signs a private file's link: base64url HMAC-SHA256 over `e_{expires}/{path}` under `secret`.
 * It is `signImageVariant` over the expiry token alone, so an image service can mint one for its source fetch.
 * `expires` is in epoch milliseconds.
 *
 * @example
 * ```ts
 * signUploadLink('photos/sunset.jpg', 1700000000000, 'secret')
 * // -> 'lbshLgROalNk_URHWIraK7YDalfVmPq9WlenM8B9Ytg'
 * ```
 */
export function signUploadLink(path: string, expires: number, secret: string): string {
  return signImageVariant(`e_${expires}`, path, secret);
}

/**
 * Whether `signature` signs the link under any of `secrets`.
 * Compares in constant time, so a route can call it on untrusted input.
 *
 * @example
 * ```ts
 * const signature = signUploadLink('photos/sunset.jpg', 1700000000000, 'old')
 *
 * verifyUploadLink(signature, 'photos/sunset.jpg', 1700000000000, ['new', 'old']) // -> true
 * verifyUploadLink(signature, 'photos/sunset.jpg', 1700000000000, ['new'])        // -> false
 * ```
 */
export function verifyUploadLink(
  signature: string,
  path: string,
  expires: number,
  secrets: readonly string[],
): boolean {
  return verifyImageVariant(signature, `e_${expires}`, path, secrets);
}
