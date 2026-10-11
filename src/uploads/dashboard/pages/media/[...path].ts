import { mediaLibraryPage } from 'app/components/media-library.ts';
import { defineDashboardPage, useFrame } from 'ohnejs/dashboard';

/**
 * The media library inside a folder; `path` is the folder's path.
 */
export default defineDashboardPage((route) => {
  useFrame({ fill: true });
  return mediaLibraryPage(route);
});
