import type { User } from 'ohnejs/auth';

import { hook } from 'ohnejs';
import { userCan } from 'ohnejs/auth';
import { hasRoute, isEmpty, isUndefined, parseBytes, parseDuration } from 'ohnejs/utils';

import type { DashboardMenuGroup, DashboardMenuItem } from '../../base/api/dashboard.get.ts';

import { translate } from '../../ohne/http/translate.ts';
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

const UPLOADS_ROW = '/collections/uploads';
const BOOKKEEPING_ROWS = new Set(['/collections/uploads-journal', '/collections/uploads-sessions']);
const MEDIA_ROW = '/media';

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

hook('dashboard:menu', (menu, { user }) => mediaMenu(menu, user));

hook('dashboard:meta', (meta) => {
  const { maxFileSize, linkMaxAge, chunkSize } = useUploadsConfig();
  meta.uploads = { maxFileSize: parseBytes(maxFileSize), linkMaxAge: parseDuration(linkMaxAge) };
  if (resumable(meta.routes)) meta.uploads.chunkSize = parseBytes(chunkSize);
});

/**
 * The sidebar as the uploads layer shows it: the media page instead of the `Uploads` table, no bookkeeping.
 * The `Uploads` row is rewritten where it stands, so a configured group keeps its place.
 * A viewer who may read `Uploads` but has no row for it gets the media row appended.
 * An app that declares its own `/media` link gets no appended row beside it.
 */
function mediaMenu(menu: readonly DashboardMenuGroup[], user: User): DashboardMenuGroup[] {
  const groups = menu
    .map((group) => ({ ...group, items: group.items.flatMap(replaceRow) }))
    .filter((group) => !isEmpty(group.items));
  const hasMedia = groups.some((group) => group.items.some((item) => item.to === MEDIA_ROW));
  if (!hasMedia && userCan(user, 'collection.Uploads.read')) {
    groups.push({ label: '', items: [mediaRow()] });
  }
  return groups;
}

/**
 * The rows one resolved row becomes.
 * The journal and sessions rows are dropped, and the `Uploads` row becomes the media row.
 */
function replaceRow(item: DashboardMenuItem): DashboardMenuItem[] {
  if (BOOKKEEPING_ROWS.has(item.to)) return [];
  return [item.to === UPLOADS_ROW ? mediaRow() : item];
}

/**
 * The media page's row, its label in the viewer's language.
 */
function mediaRow(): DashboardMenuItem {
  return { to: MEDIA_ROW, label: translate('uploads.menu.media'), icon: 'library-photo' };
}

/**
 * Whether the dashboard may send a file in chunks while the app serves `routes`.
 * It takes a storage with `parts` and the routes that open, fill and complete a session.
 * An app that drops one of them through `disable.routes` keeps every upload whole.
 * Dropping only `DELETE /uploads/sessions/[uuid]` keeps chunks: an abort then leaves its session to expire.
 */
function resumable(routes: readonly string[]): boolean {
  return !isUndefined(useStorage().parts) && SESSION_ROUTES.every((id) => hasRoute(routes, id));
}
