import { useConfig } from 'ohnejs';
import { isUndefined, normalizeBasePath, parseDuration, stringifySearchParams } from 'ohnejs/utils';
import { codeSpan } from 'ohnejs/utils/ansi';

import { ohneError } from '../../ohne/error/ohne-error.ts';
import { useUploadsConfig } from '../config.ts';
import { uploadSecrets } from '../images/sign.ts';
import { useStorage } from '../storage/use-storages.ts';
import { LINK_MAX_AGE } from './_link-age.ts';
import { type UploadLocation, uploadPath } from './path.ts';
import { signUploadLink } from './sign.ts';

const TRAILING_SLASHES = /\/+$/;

/**
 * An upload a URL is built for: its location, and whether its bytes are locked.
 * A record straight from a read fits; so does a hand-built location.
 */
export interface UploadURLSource extends UploadLocation {
  /**
   * Whether the bytes open only through an expiring link or for a signed-in reader.
   * Omitted or `null`, the file is public.
   */
  private?: boolean | null;

  /**
   * When a private file's link stops working, in epoch milliseconds, at most 30 days ahead.
   * Omitted, the link is the bare API route, which only a signed-in reader can open.
   */
  expires?: number;
}

/**
 * A link to a private file that anyone can open until it expires.
 */
export interface TemporaryUploadLink {
  /**
   * The signed API route, `/uploads/<path>?e=<expires>&s=<signature>`.
   */
  url: string;

  /**
   * When the link stops working, in epoch milliseconds.
   */
  expires: number;
}

/**
 * The URL a file's bytes are served from.
 * With `uploads.publicURL` set it is that origin plus the path.
 * Otherwise it is the storage backend's own `url`, when the backend serves its objects itself.
 * Failing both, it is the API's own `/uploads/<path>`.
 * A private file always takes the API route, since nothing else checks who is asking.
 * Its route carries `?e=&s=` when `expires` is given and `UPLOADS_SECRET` can sign it.
 * The API form is root-relative, so a client resolves it against the API origin it already knows.
 *
 * @example
 * ```ts
 * uploadURL({ directory: 'photos', name: 'sunset.jpg' })
 * // -> '/uploads/photos/sunset.jpg'
 *
 * uploadURL({ directory: 'photos', name: 'sunset.jpg', private: true, expires: 1700000000000 })
 * // -> '/uploads/photos/sunset.jpg?e=1700000000000&s=...'
 * ```
 */
export function uploadURL(upload: UploadURLSource): string {
  const path = uploadPath(upload);
  if (upload.private === true) return privateURL(path, upload.expires);
  const { publicURL } = useUploadsConfig();
  if (!isUndefined(publicURL)) return `${publicURL.replace(TRAILING_SLASHES, '')}/${path}`;
  return useStorage().url?.(path) ?? apiURL(path);
}

/**
 * A link to a private file that anyone can open for `maxAge` from now.
 * `maxAge` is milliseconds or a string like `'7d'`.
 * Unlike a read's links it is not aligned to a window, so it lasts exactly as long as asked.
 * `maxAge` is above zero and at most 30 days; anything else throws.
 * Throws without an `UPLOADS_SECRET`, since nothing could sign it.
 *
 * @example
 * ```ts
 * temporaryUploadURL({ directory: 'photos', name: 'sunset.jpg' }, '7d')
 * // -> { url: '/uploads/photos/sunset.jpg?e=1700604800000&s=...', expires: 1700604800000 }
 * ```
 */
export function temporaryUploadURL(
  location: UploadLocation,
  maxAge: number | string,
): TemporaryUploadLink {
  const [secret] = uploadSecrets();
  if (isUndefined(secret)) throw ohneError('Set `UPLOADS_SECRET` to make temporary links');
  const ms = parseDuration(maxAge);
  if (!(ms > 0 && ms <= LINK_MAX_AGE)) {
    throw ohneError({
      title: `Link \`maxAge\` ${codeSpan(String(maxAge))} is out of range`,
      body: ['A temporary link lasts more than `0` and at most `30d`.'],
    });
  }
  const expires = Date.now() + ms;
  return { url: signedURL(uploadPath(location), expires, secret), expires };
}

/**
 * The API's own route for `path`, root-relative.
 */
function apiURL(path: string): string {
  return `${normalizeBasePath(useConfig().api.basePath)}/uploads/${path}`;
}

/**
 * The API route with `?e=&s=` appended, signed under `secret`.
 */
function signedURL(path: string, expires: number, secret: string): string {
  const s = signUploadLink(path, expires, secret);
  return `${apiURL(path)}?${stringifySearchParams({ e: expires, s })}`;
}

/**
 * A private file's route: signed when `expires` is given and a secret can sign, else the bare one.
 */
function privateURL(path: string, expires: number | undefined): string {
  const [secret] = uploadSecrets();
  if (isUndefined(expires) || isUndefined(secret)) return apiURL(path);
  if (expires > Date.now() + LINK_MAX_AGE) {
    throw ohneError(`A private link to ${codeSpan(path)} cannot expire past \`30d\` from now`);
  }
  return signedURL(path, expires, secret);
}
