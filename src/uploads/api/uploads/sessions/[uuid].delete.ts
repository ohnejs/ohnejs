import { defineHandler } from 'ohnejs';
import { requireCapability } from 'ohnejs/auth';

import { SESSION_ROUTE_OPTIONS } from '../../../uploads/_body.ts';
import { abortUploadSession } from '../../../uploads/abort-upload-session.ts';

/**
 * `DELETE /uploads/sessions/[uuid]`
 *
 * Aborts a session, dropping every byte it holds in storage, and answers `204`.
 * A completed session loses only its bookkeeping, and the file it landed as stays.
 * Needs `collection.Uploads.create`: no user `401`, no capability `403`.
 * An unknown session, or another user's, is a `404`.
 * An expired one is discarded all the same, answering `204`.
 */
export default defineHandler(async ({ params }): Promise<null> => {
  const { UUID: author } = await requireCapability('collection.Uploads.create');
  await abortUploadSession(params.uuid, { author });
  return null;
}, SESSION_ROUTE_OPTIONS);
