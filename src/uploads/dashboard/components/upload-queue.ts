import { apiUpload, dispatchTrigger } from 'ohne/dashboard';
import { isPlainObject, isString } from 'ohne/utils';

import type { UploadRecord } from '../../uploads/types.ts';
import type {
  UploadItem,
  UploadOutcome,
  UploadSendHooks,
  UploadTask,
} from './upload-queue-state.ts';

import { MEDIA_REFRESH } from './media-library-state.ts';
import { createUploadQueue } from './upload-queue-state.ts';

const OCTET_STREAM = 'application/octet-stream';

const queue = createUploadQueue(send);

/**
 * Every queued upload, newest batch first.
 * Reactive.
 */
export function uploadTasks(): readonly UploadTask[] {
  return queue.tasks();
}

/**
 * The measured upload speed in bytes per second, `null` before the first upload sends bytes.
 * Reactive.
 */
export function uploadSpeed(): number | null {
  return queue.speed();
}

/**
 * Drops a task from the upload history.
 */
export function hideUploadTask(id: string): void {
  queue.hide(id);
}

/**
 * Queues files for upload, each into its folder, and dispatches the media refresh trigger once they settle.
 * At most five run at once; each task in `uploadTasks` reports its own status and progress.
 */
export async function uploadFiles(items: readonly UploadItem[]): Promise<void> {
  if (items.length === 0) return;
  await queue.enqueue(items);
  dispatchTrigger(MEDIA_REFRESH);
}

/**
 * Sends one file as the raw body of `POST /uploads`, the target folder and name in the query.
 * A `2xx` answers the stored record, which may carry a suffixed name.
 * An error status answers its wire message.
 */
async function send(task: UploadTask, file: File, hooks: UploadSendHooks): Promise<UploadOutcome> {
  const query = `directory=${encodeURIComponent(task.directory)}&name=${encodeURIComponent(task.name)}`;
  const response = await apiUpload(`POST /uploads?${query}`, file, {
    ...hooks,
    headers: { 'content-type': file.type || OCTET_STREAM },
  });
  if (response.ok) {
    const { UUID, name, directory } = (await response.json()) as UploadRecord;
    return { ok: true, UUID, name, directory };
  }
  return { ok: false, error: await wireErrorOf(response) };
}

/**
 * The message an error response carries: the first field error of a `422`, else the wire `message`.
 */
async function wireErrorOf(response: Response): Promise<string> {
  const body: unknown = await response.json().catch(() => null);
  if (!isPlainObject(body)) return response.statusText;
  const errors = isPlainObject(body.data) ? body.data.errors : null;
  if (isPlainObject(errors)) {
    for (const message of Object.values(errors)) if (isString(message)) return message;
  }
  return isString(body.message) ? body.message : response.statusText;
}
