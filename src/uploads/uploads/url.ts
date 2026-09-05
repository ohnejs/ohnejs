import { useConfig } from 'ohne';
import { isUndefined, normalizeBasePath } from 'ohne/utils';

import { useUploadsConfig } from '../config.ts';
import { type UploadLocation, uploadPath } from './path.ts';

const TRAILING_SLASHES = /\/+$/;

/**
 * The URL a file's bytes are served from.
 * With `uploads.publicURL` set it is that origin plus the path; otherwise the API's own `/uploads/<path>`.
 * The API form is root-relative, so a client resolves it against the API origin it already knows.
 *
 * @example
 * ```ts
 * uploadURL({ directory: 'photos', name: 'sunset.jpg' })
 * // -> '/uploads/photos/sunset.jpg'
 * ```
 */
export function uploadURL(location: UploadLocation): string {
  const { publicURL } = useUploadsConfig();
  const base = isUndefined(publicURL)
    ? `${normalizeBasePath(useConfig().api.basePath)}/uploads`
    : publicURL.replace(TRAILING_SLASHES, '');
  return `${base}/${uploadPath(location)}`;
}
