import { api, apiUpload, dispatchTrigger, toast } from 'ohnejs/dashboard';
import { sleep } from 'ohnejs/utils';

import type { UploadRecord } from '../../uploads/types.ts';
import type {
  UploadItem,
  UploadOutcome,
  UploadSendHooks,
  UploadTask,
} from './upload-queue-state.ts';

import { useUploadsT } from './_messages.ts';
import { readWireError } from './_wire-error.ts';
import { MEDIA_REFRESH } from './media-library-state.ts';
import { createUploadQueue } from './upload-queue-state.ts';

const OCTET_STREAM = 'application/octet-stream';

/**
 * How many times a URL upload asks before it takes a `429` as its answer.
 * An aborted fetch frees its permit only once the server notices the client left, a moment after the abort.
 */
const FETCH_ATTEMPTS = 5;

/**
 * How long a URL upload waits after a `429` before it asks again, in milliseconds.
 */
const FETCH_RETRY_DELAY = 500;

const queue = createUploadQueue(send, { onSettle: announce });

/**
 * Every queued upload, newest batch first.
 * Reactive.
 */
export function uploadTasks(): readonly UploadTask[] {
  return queue.tasks();
}

/**
 * The measured upload speed in bytes per second, `null` before the first measurement.
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
 * Queues files, or URLs the server fetches, each into its folder.
 * Dispatches the media refresh trigger once they settle.
 * At most five run at once, and no more URLs than the fetch route allows one user.
 * Each task in `uploadTasks` reports its own status and progress.
 */
export async function uploadFiles(items: readonly UploadItem[]): Promise<void> {
  if (items.length === 0) return;
  await queue.enqueue(items);
  dispatchTrigger(MEDIA_REFRESH);
}

/**
 * Toasts a failed upload with its reason, so nobody has to open the bell to learn why.
 * A completed upload stays quiet: the grid and the bell already show it.
 */
function announce(task: UploadTask): void {
  if (task.status !== 'failed') return;
  toast(useUploadsT()('uploads.dashboard.uploadFailed'), {
    type: 'error',
    description: task.error,
  });
}

/**
 * Sends one item and reads the answer.
 * A `2xx` answers the stored record, which may carry a suffixed name.
 * An error status answers its wire message.
 */
async function send(
  task: UploadTask,
  item: UploadItem,
  hooks: UploadSendHooks,
): Promise<UploadOutcome> {
  const response =
    'file' in item
      ? await sendFile(task, item.file, hooks)
      : await sendURL(task, item.url, hooks.signal);
  if (response.ok) {
    const { UUID, name, directory, size } = (await response.json()) as UploadRecord;
    return { ok: true, UUID, name, directory, size };
  }
  return { ok: false, error: (await readWireError(response)).message };
}

/**
 * Sends a file as the raw body of `POST /uploads`, the target folder and name in the query.
 */
function sendFile(task: UploadTask, file: File, hooks: UploadSendHooks): Promise<Response> {
  const query = `directory=${encodeURIComponent(task.directory)}&name=${encodeURIComponent(task.name)}`;
  return apiUpload(`POST /uploads?${query}`, file, {
    ...hooks,
    headers: { 'content-type': file.type || OCTET_STREAM },
  });
}

/**
 * Asks `POST /uploads/fetch` to store what a URL answers; the server names the file from the response.
 * A `429` is asked again after a pause, up to `FETCH_ATTEMPTS` times.
 * An abort during the pause fails the next ask at once.
 */
async function sendURL(task: UploadTask, url: string, signal: AbortSignal): Promise<Response> {
  for (let attempt = 1; ; attempt++) {
    const response = await api('POST /uploads/fetch', {
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ url, directory: task.directory }),
      signal,
    });
    if (response.status !== 429 || attempt === FETCH_ATTEMPTS) return response;
    await sleep(FETCH_RETRY_DELAY);
  }
}
