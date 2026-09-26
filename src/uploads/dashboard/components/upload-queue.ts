import {
  api,
  apiUpload,
  dismissToast,
  dispatchTrigger,
  sessionUser,
  toast,
} from 'ohnejs/dashboard';
import { effect, formatBytes, isUndefined, sleep, untracked } from 'ohnejs/utils';

import type { RememberedUpload } from './_remembered-uploads.ts';
import type {
  UploadItem,
  UploadOutcome,
  UploadSendHooks,
  UploadTask,
} from './upload-queue-state.ts';
import type { SessionTransport } from './upload-session.ts';

import { useUploadsT } from './_messages.ts';
import { uploadsMeta } from './_meta.ts';
import { createRememberedUploads, matchesFile } from './_remembered-uploads.ts';
import { MEDIA_REFRESH } from './media-library-state.ts';
import { createUploadQueue } from './upload-queue-state.ts';
import {
  abandonAborted,
  discardSession,
  readUploadOutcome,
  sendResumable,
} from './upload-session.ts';

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

const TRANSPORT: SessionTransport = { api, apiUpload, sleep };

// Web Locks need a secure context; without them each tab remembers only its own uploads.
const locks = 'locks' in navigator ? navigator.locks : undefined;

const remembered = createRememberedUploads({
  storage: () => (isUndefined(locks) ? sessionStorage : localStorage),
  user: () => sessionUser()?.UUID,
  locks,
});

const queue = createUploadQueue(send, { onSettle: settled });

let owner: string | undefined;

// Another user, or none, must never see the previous user's uploads, nor keep sending them.
effect(() => {
  const user = sessionUser()?.UUID;
  if (user !== owner) untracked(queue.clear);
  owner = user;
});

/**
 * Every queued upload, newest batch first.
 * Reactive.
 */
export function uploadTasks(): readonly UploadTask[] {
  return queue.tasks();
}

/**
 * The measured upload speed in bytes per second, `null` before the first measurement.
 * A stall drops it until bytes flow again.
 * Reactive.
 */
export function uploadSpeed(): number | null {
  return queue.speed();
}

/**
 * Drops a task from the upload history, and the toast of its failure.
 * A failed or pending task lets its session go, as hiding an interrupted upload does.
 */
export function hideUploadTask(id: string): void {
  const task = queue.tasks().find((candidate) => candidate.id === id);
  queue.hide(id);
  dismissToast(id);
  if ((task?.status === 'failed' || task?.status === 'pending') && !isUndefined(task.session)) {
    void discardSession(task.session, TRANSPORT, remembered);
  }
}

/**
 * Sends a failed upload again, continuing its session when it has one.
 * Dispatches the media refresh trigger once it completes.
 */
export async function retryUploadTask(id: string): Promise<void> {
  const task = await queue.retry(id);
  if (task?.status === 'completed') dispatchTrigger(MEDIA_REFRESH);
}

/**
 * The signed-in user's resumable uploads an earlier page left open.
 * Each waits for its file to be picked again.
 * One another tab is sending joins only once that tab stops.
 * Reactive.
 */
export function interruptedUploads(): readonly RememberedUpload[] {
  return remembered.interrupted();
}

/**
 * Continues the interrupted upload `entry` with a picked `file`.
 * A file other than the one the session holds is refused with a toast, and the interrupted row stays.
 */
export function resumeUpload(entry: RememberedUpload, file: File): void {
  if (matchesFile(entry, file)) {
    void uploadFiles([{ file, directory: entry.directory }]);
    return;
  }
  toast(useUploadsT()('uploads.dashboard.notTheSameFile', { name: entry.name }), { type: 'error' });
}

/**
 * Stops offering the interrupted upload of `session`, and drops its bytes unless another tab is sending it.
 */
export function discardInterruptedUpload(session: string): void {
  void discardSession(session, TRANSPORT, remembered);
}

/**
 * Queues files, or URLs the server fetches, each into its folder.
 * A file that an interrupted upload was sending continues that upload's session.
 * Dispatches the media refresh trigger once they settle.
 * At most five run at once, and no more URLs than the fetch route allows one user.
 * Each task in `uploadTasks` reports its own status and progress.
 */
export async function uploadFiles(items: readonly UploadItem[]): Promise<void> {
  if (items.length === 0) return;
  await queue.enqueue(items.map(resumed));
  dispatchTrigger(MEDIA_REFRESH);
}

/**
 * Settles what a finished task leaves behind.
 * An aborted task's session is abandoned, so the server drops its bytes.
 * A failed task is toasted with its reason, so nobody has to open the bell to learn why.
 * The toast offers a Retry while the task is listed.
 * Hiding the task dismisses the toast, since hiding lets the file go.
 * A completed upload stays quiet: the grid and the bell already show it.
 */
function settled(task: UploadTask): void {
  abandonAborted(task, TRANSPORT, remembered);
  if (task.status !== 'failed') return;
  const t = useUploadsT();
  const listed = queue.tasks().some(({ id }) => id === task.id);
  toast(t('uploads.dashboard.uploadFailed'), {
    id: task.id,
    type: 'error',
    description: task.error,
    action: listed
      ? { label: t('uploads.dashboard.retry'), onClick: () => void retryUploadTask(task.id) }
      : undefined,
  });
}

/**
 * `item` bound to the session of the interrupted upload its file continues, if one matches.
 */
function resumed(item: UploadItem): UploadItem {
  if (!('file' in item)) return item;
  const entry = remembered.claim(item.file, item.directory);
  return isUndefined(entry) ? item : { ...item, session: entry.session };
}

/**
 * Sends one item and reads the answer.
 * A file over the discovery read's `maxFileSize` fails at once, without a request.
 * A file with a session, or one larger than a chunk, goes up in chunks through `sendResumable`.
 * A `2xx` answers the stored record, which may carry a suffixed name.
 * An error status answers its wire message.
 */
async function send(
  task: UploadTask,
  item: UploadItem,
  hooks: UploadSendHooks,
): Promise<UploadOutcome> {
  if ('url' in item) return readUploadOutcome(await sendURL(task, item.url, hooks.signal));
  const { file } = item;
  const limits = uploadsMeta();
  if (!isUndefined(limits) && file.size > limits.maxFileSize) {
    const max = formatBytes(limits.maxFileSize);
    return { ok: false, error: useUploadsT()('uploads.errors.fileTooLarge', { max }) };
  }
  if (!isUndefined(task.session) || file.size > (limits?.chunkSize ?? Infinity)) {
    return sendResumable(task, file, hooks, TRANSPORT, remembered);
  }
  return readUploadOutcome(await sendFile(task, file, hooks));
}

/**
 * Sends a file as the raw body of `POST /uploads`, the target folder and name in the query.
 */
function sendFile(task: UploadTask, file: File, hooks: UploadSendHooks): Promise<Response> {
  const query = `directory=${encodeURIComponent(task.directory)}&name=${encodeURIComponent(task.name)}`;
  return apiUpload(`POST /uploads?${query}`, file, {
    signal: hooks.signal,
    onProgress: hooks.onProgress,
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
