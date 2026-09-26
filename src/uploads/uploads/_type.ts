import { extname, mediaTypeMatches, mimeTypeFor, parseMediaType } from 'ohnejs/utils';

import { useUploadsConfig } from '../config.ts';
import { uploadsError } from './_errors.ts';

const OCTET_STREAM = 'application/octet-stream';

/**
 * The media type a file named `name` is stored as, derived from its extension without parameters.
 * An unknown or missing extension is `application/octet-stream`.
 */
export function uploadType(name: string): string {
  return parseMediaType(mimeTypeFor(extname(name)) ?? OCTET_STREAM).type;
}

/**
 * Refuses `type` with a `422` `typeNotAllowed` at `name` unless `uploads.types` allows it.
 */
export function assertTypeAllowed(type: string): void {
  if (!mediaTypeMatches(type, useUploadsConfig().types)) {
    throw uploadsError('name', 'typeNotAllowed', { type });
  }
}
