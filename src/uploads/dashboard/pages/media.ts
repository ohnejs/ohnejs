import { mediaLibraryPage } from 'app/components/media-library.ts';
import { defineDashboardPage, useFrame } from 'ohnejs/dashboard';

/**
 * The media library at its root folder.
 */
export default defineDashboardPage((route) => {
  useFrame({ fill: true });
  return mediaLibraryPage(route);
});
