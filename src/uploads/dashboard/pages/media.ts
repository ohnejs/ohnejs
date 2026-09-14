import { mediaLibraryPage } from 'app/components/media-library.ts';
import { shell } from 'app/components/shell.ts';
import { defineDashboardPage } from 'ohnejs/dashboard';

/**
 * The media library at its root folder.
 */
export default defineDashboardPage((route) =>
  shell(() => mediaLibraryPage(route), { noMainPadding: true, noMainScroll: true }),
);
