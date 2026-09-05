import { mediaLibraryPage } from 'app/components/media-library.ts';
import { shell } from 'app/components/shell.ts';
import { defineDashboardPage } from 'ohne/dashboard';

/**
 * The media library inside a folder; `path` is the folder's path.
 */
export default defineDashboardPage((route) =>
  shell(() => mediaLibraryPage(route), { noMainPadding: true, noMainScroll: true }),
);
