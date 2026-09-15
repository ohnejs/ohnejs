import { useConfig } from 'ohnejs';
import { isUndefined, normalizeBasePath } from 'ohnejs/utils';

import { useUploadsConfig } from '../config.ts';
import { useStorage } from '../storage/use-storages.ts';
import { type UploadLocation, uploadPath } from './path.ts';

const TRAILING_SLASHES = /\/+$/;

/**
 * The URL a file's bytes are served from.
 * With `uploads.publicURL` set it is that origin plus the path.
 * Otherwise it is the storage backend's own `url`, when the backend serves its objects itself.
 * Failing both, it is the API's own `/uploads/<path>`.
 * The API form is root-relative, so a client resolves it against the API origin it already knows.
 *
 * @example
 * ```ts
 * uploadURL({ directory: 'photos', name: 'sunset.jpg' })
 * // -> '/uploads/photos/sunset.jpg'
 * ```
 */
export function uploadURL(location: UploadLocation): string {
  const path = uploadPath(location);
  const { publicURL } = useUploadsConfig();
  if (!isUndefined(publicURL)) return `${publicURL.replace(TRAILING_SLASHES, '')}/${path}`;
  return (
    useStorage().url?.(path) ?? `${normalizeBasePath(useConfig().api.basePath)}/uploads/${path}`
  );
}
