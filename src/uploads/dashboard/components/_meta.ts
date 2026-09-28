import { dashboardMeta } from 'ohnejs/dashboard';
import { untracked } from 'ohnejs/utils';

declare module 'ohnejs/dashboard' {
  interface DashboardMeta {
    /**
     * The upload limits the uploads layer sets on every discovery read.
     */
    uploads?: UploadsMeta;
  }
}

/**
 * The upload limits of the uploads layer.
 */
export interface UploadsMeta {
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
   * Absent when the storage has no parts or the app drops a route that opens, fills or completes a session.
   * Every file then goes whole through `POST /uploads`.
   */
  chunkSize?: number;
}

/**
 * The upload limits off the discovery read, `undefined` while it loads or from an API that sends none.
 * Read untracked, so a constructor or a sender may call it.
 */
export function uploadsMeta(): UploadsMeta | undefined {
  return untracked(dashboardMeta)?.uploads;
}
