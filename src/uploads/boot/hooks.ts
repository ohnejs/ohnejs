import { hook } from 'ohnejs';
import { hasRoute, isUndefined, parseBytes, parseDuration } from 'ohnejs/utils';

import { useUploadsConfig } from '../config.ts';
import { useStorage } from '../storage/use-storages.ts';
import { decorateUploads } from '../uploads/decorate.ts';

declare module '../../base/api/dashboard.get.ts' {
  interface DashboardMeta {
    /**
     * The upload limits of the uploads layer, set on every discovery read.
     */
    uploads?: {
      /**
       * The largest file one upload may carry, in bytes.
       */
      maxFileSize: number;

      /**
       * The longest a private file's link may last, in milliseconds.
       */
      linkMaxAge: number;

      /**
       * The size of every chunk of a resumable upload but the last, in bytes.
       * Absent when the storage cannot assemble parts.
       * Also absent when the app drops a route that opens, fills or completes a session.
       * The dashboard then sends every file whole through `POST /uploads`.
       */
      chunkSize?: number;
    };
  }
}

const SESSION_ROUTES = [
  'POST /uploads/sessions',
  'PATCH /uploads/sessions/[uuid]',
  'POST /uploads/sessions/[uuid]/complete',
];

hook('query:records', (records, { collection }) => {
  if (collection === 'Uploads') decorateUploads(records);
});

hook('populate:targets', (targets, { collection }) => {
  if (collection === 'Uploads') decorateUploads(targets);
});

hook('dashboard:meta', (meta) => {
  const { maxFileSize, linkMaxAge, chunkSize } = useUploadsConfig();
  meta.uploads = { maxFileSize: parseBytes(maxFileSize), linkMaxAge: parseDuration(linkMaxAge) };
  if (resumable(meta.routes)) meta.uploads.chunkSize = parseBytes(chunkSize);
});

/**
 * Whether the dashboard may send a file in chunks while the app serves `routes`.
 * It takes a storage with `parts` and the routes that open, fill and complete a session.
 * An app that drops one of them through `disable.routes` keeps every upload whole.
 * Dropping only `DELETE /uploads/sessions/[uuid]` keeps chunks: an abort then leaves its session to expire.
 */
function resumable(routes: readonly string[]): boolean {
  return !isUndefined(useStorage().parts) && SESSION_ROUTES.every((id) => hasRoute(routes, id));
}
