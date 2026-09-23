import { isEmpty } from 'ohnejs/utils';

import { uploadSecrets } from './sign.ts';

/**
 * Whether the layer keeps private files at all: `UPLOADS_SECRET` names a secret that signs their links.
 * Without one every file is served publicly, a stored `private` is ignored, and the dashboard hides it.
 */
export function privateUploads(): boolean {
  return !isEmpty(uploadSecrets());
}
