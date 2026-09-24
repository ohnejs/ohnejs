import { alignExpiry, isEmpty, parseDuration } from 'ohnejs/utils';

import { useUploadsConfig } from '../config.ts';
import { uploadSecrets } from '../images/sign.ts';

/**
 * When the links a read mints now for a private file stop working, in epoch milliseconds.
 * Aligned to `uploads.privateMaxAge` windows, so every read inside one window mints the same URLs.
 * `undefined` without an `UPLOADS_SECRET`, when nothing can sign a link.
 */
export function privateExpiry(): number | undefined {
  if (isEmpty(uploadSecrets())) return undefined;
  return alignExpiry(Date.now(), parseDuration(useUploadsConfig().privateMaxAge));
}
