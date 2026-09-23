import type { User } from 'ohnejs/auth';

import { hook } from 'ohnejs';
import { userCan } from 'ohnejs/auth';
import { isEmpty } from 'ohnejs/utils';

import type { DashboardMenuGroup, DashboardMenuItem } from '../../base/api/dashboard.get.ts';

declare module '../../base/api/dashboard.get.ts' {
  interface DashboardMeta {
    /**
     * Whether the layer keeps private files, which needs an `UPLOADS_SECRET` to sign their links.
     * The dashboard hides every private control while it is not `true`.
     */
    privateUploads?: boolean;
  }
}

import { translate } from '../../ohne/http/translate.ts';
import { privateUploads } from '../uploads/_private.ts';
import { decorateUploads } from '../uploads/decorate.ts';

const UPLOADS_ROW = '/collections/uploads';
const JOURNAL_ROW = '/collections/uploads-journal';
const MEDIA_ROW = '/media';

hook('query:records', (records, { collection }) => {
  if (collection === 'Uploads') decorateUploads(records);
});

hook('populate:targets', (targets, { collection }) => {
  if (collection === 'Uploads') decorateUploads(targets);
});

hook('dashboard:menu', (menu, { user }) => mediaMenu(menu, user));

hook('dashboard:meta', (meta) => {
  meta.privateUploads = privateUploads();
});

/**
 * The sidebar as the uploads layer shows it: the media page instead of the `Uploads` table, no journal.
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
 * The rows one resolved row becomes: the journal row is dropped, the `Uploads` row becomes the media row.
 */
function replaceRow(item: DashboardMenuItem): DashboardMenuItem[] {
  if (item.to === JOURNAL_ROW) return [];
  return [item.to === UPLOADS_ROW ? mediaRow() : item];
}

/**
 * The media page's row, its label in the viewer's language.
 */
function mediaRow(): DashboardMenuItem {
  return { to: MEDIA_ROW, label: translate('uploads.menu.media'), icon: 'library-photo' };
}
