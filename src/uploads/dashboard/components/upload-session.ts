import { isUndefined } from 'ohnejs/utils';

import type { UploadRecord, UploadSession } from '../../uploads/types.ts';
import type { RememberedUploads } from './_remembered-uploads.ts';
import type { UploadOutcome, UploadSendHooks, UploadTask } from './upload-queue-state.ts';

import { readWireError } from './_wire-error.ts';

/**
 * What a resumable upload sends through: the dashboard's `api`, `apiUpload`, and `sleep` in the browser.
 */
export interface SessionTransport {
  /**
   * Sends a request, as `api` does.
   */
  api(route: string, init?: RequestInit): Promise<Response>;

  /**
   * Sends `body` and reports its progress, as `apiUpload` does.
   */
  apiUpload(
    route: string,
    body: Blob,
    options: {
      signal: AbortSignal;
      headers: Record<string, string>;
      onProgress(loaded: number, total: number): void;
    },
  ): Promise<Response>;

  /**
   * Resolves after `delay` milliseconds, or rejects with the reason of `signal` once it aborts.
   */
  sleep(delay: number, options: { signal: AbortSignal }): Promise<void>;
}

/**
 * The waits before each new attempt at a request that failed in transit, in milliseconds.
 */
const RETRY_DELAYS = [1000, 2000, 4000, 8000, 16000];

/**
 * The statuses below `500` that pass with time: a timeout, a request sent too early, and a rate limit.
 */
const TRANSIENT_STATUSES = new Set([408, 425, 429]);

const OCTET_STREAM = 'application/octet-stream';

/**
 * Sends `file` through a resumable session, one chunk per request, and answers how it went.
 * Without a `session` on the task, one is created and reported through `hooks.onSession`.
 * A task's own session continues where the server stands, which `complete` answers with a `409`.
 * Every answer carrying the session is remembered, so a reload can resume it; completion forgets it.
 * Every request after the create runs while this tab holds the session's lock, so no other tab offers it.
 * While another tab holds it, the send waits.
 * A session the create answers after an abort is abandoned at once, since no task knows it.
 * A `409` resyncs to the offset it carries, at no attempt's cost.
 * A network failure or a transient status is retried after each of `RETRY_DELAYS`, stalled while waiting.
 * Once those run out, the task fails and keeps its session.
 * A `404`, a `413`, or a chunk's `422` ends the session: the task drops it, and it is forgotten.
 * The server answers a `413` before its handler runs and still holds the session, so it is abandoned.
 * A `404` on the probe of a known session finds it gone, so the file goes up again in a fresh session.
 * Any other error is final and forgotten too; the task keeps its session, so a fixed cause can be retried.
 * An abort rejects with the signal's reason and remembers nothing more.
 */
export async function sendResumable(
  task: UploadTask,
  file: File,
  hooks: UploadSendHooks,
  transport: SessionTransport,
  remembered: RememberedUploads,
): Promise<UploadOutcome> {
  const { signal } = hooks;
  let reported = 0;

  const progress = (bytes: number): void => {
    reported = Math.max(reported, bytes);
    hooks.onProgress(reported, file.size);
  };

  const learn = (next: UploadSession): void => {
    signal.throwIfAborted();
    remembered.remember({
      session: next.UUID,
      directory: task.directory,
      name: file.name,
      size: file.size,
      lastModified: file.lastModified,
      type: file.type,
      offset: next.offset,
      chunkSize: next.chunkSize,
      expiresAt: next.expiresAt,
    });
    progress(next.offset);
  };

  let uuid = task.session;
  let session: UploadSession | undefined;
  if (isUndefined(uuid)) {
    const response = await exchange(
      () =>
        // Unsignalled: a session answered after an abort is still named, so it can be abandoned.
        transport.api('POST /uploads/sessions', {
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ directory: task.directory, name: task.name, size: file.size }),
        }),
      transport,
      hooks,
    );
    if (!response.ok) return readUploadOutcome(response);
    session = await sessionOf(response);
    uuid = session.UUID;
    if (signal.aborted) abandonSession(uuid, transport, remembered);
    signal.throwIfAborted();
    hooks.onSession(uuid);
  }

  const outcome = await remembered.hold(uuid, signal, async () => {
    if (!isUndefined(session)) learn(session);
    for (;;) {
      const chunk = !isUndefined(session) && session.offset < session.size ? session : undefined;
      const response = await exchange(
        () =>
          isUndefined(chunk)
            ? transport.api(`POST ${sessionRoute(uuid)}/complete`, { signal })
            : transport.apiUpload(
                `PATCH ${sessionRoute(uuid)}`,
                file.slice(chunk.offset, chunk.offset + chunk.chunkSize),
                {
                  signal,
                  headers: { 'content-type': OCTET_STREAM, 'upload-offset': String(chunk.offset) },
                  onProgress: (loaded) => progress(chunk.offset + loaded),
                },
              ),
        transport,
        hooks,
      );
      if (response.status === 409 || (response.ok && !isUndefined(chunk))) {
        session = await sessionOf(response);
        learn(session);
        continue;
      }
      if (response.ok || !isTransient(response.status)) remembered.forget(uuid);
      if (response.status === 413) sendDelete(uuid, transport);
      if (endsSession(response.status, !isUndefined(chunk))) hooks.onSession(undefined);
      if (response.status === 404 && isUndefined(session)) return undefined;
      return readUploadOutcome(response);
    }
  });
  return (
    outcome ?? sendResumable({ ...task, session: undefined }, file, hooks, transport, remembered)
  );
}

/**
 * Ends the session `session` for good: forgets it and asks the server to drop its bytes.
 * The request goes out with `keepalive` and is not awaited, so it outlives a page that is closing.
 * A request that never arrives leaves the session to expire.
 */
export function abandonSession(
  session: string,
  transport: Pick<SessionTransport, 'api'>,
  remembered: RememberedUploads,
): void {
  remembered.forget(session);
  sendDelete(session, transport);
}

/**
 * Lets go of the session of a hidden row: forgets it and asks the server to drop its bytes.
 * A session another tab is sending is left alone, since that tab still needs it.
 */
export async function discardSession(
  session: string,
  transport: Pick<SessionTransport, 'api'>,
  remembered: RememberedUploads,
): Promise<void> {
  if (await remembered.discard(session)) sendDelete(session, transport);
}

/**
 * Abandons the session of `task` once it is aborted, pending or running, as `abandonSession` does.
 * A failed task keeps its session for a retry, and a completed one was forgotten as it completed.
 */
export function abandonAborted(
  task: UploadTask,
  transport: Pick<SessionTransport, 'api'>,
  remembered: RememberedUploads,
): void {
  if (task.status === 'aborted' && !isUndefined(task.session)) {
    abandonSession(task.session, transport, remembered);
  }
}

/**
 * Reads the answer that ends an upload: a `2xx` carries the stored record, any other status its wire message.
 */
export async function readUploadOutcome(response: Response): Promise<UploadOutcome> {
  if (!response.ok) return { ok: false, error: (await readWireError(response)).message };
  const { UUID, name, directory, size } = (await response.json()) as UploadRecord;
  return { ok: true, UUID, name, directory, size };
}

/**
 * Sends `request` until it answers a status worth reading.
 * A network failure or a transient status sends it again after the next of `RETRY_DELAYS`, stalled meanwhile.
 * Once the delays run out, the last attempt answers as it is, and a network failure rejects.
 */
async function exchange(
  request: () => Promise<Response>,
  transport: SessionTransport,
  hooks: UploadSendHooks,
): Promise<Response> {
  for (const delay of RETRY_DELAYS) {
    let response: Response | undefined;
    try {
      response = await request();
    } catch (error) {
      if (hooks.signal.aborted || !(error instanceof TypeError)) throw error;
    }
    if (!isUndefined(response) && !isTransient(response.status)) return response;
    hooks.onStall(true);
    await transport.sleep(delay, { signal: hooks.signal });
    hooks.onStall(false);
  }
  return request();
}

/**
 * Asks the server to drop the bytes of `session`, with `keepalive` so the request outlives a closing page.
 * Nothing awaits it, and a failure is ignored: the session then expires.
 */
function sendDelete(session: string, transport: Pick<SessionTransport, 'api'>): void {
  void transport.api(`DELETE ${sessionRoute(session)}`, { keepalive: true }).catch(() => undefined);
}

/**
 * The session an answer carries: a `2xx` body, or the `data` of a `409`.
 */
async function sessionOf(response: Response): Promise<UploadSession> {
  const body: unknown = await response.json();
  return (response.status === 409 ? (body as { data: unknown }).data : body) as UploadSession;
}

/**
 * Whether an answer of `status` ends the session; `chunk` tells the answer to a chunk from any other.
 * A `404` finds it gone or expired, and a `413` refuses a chunk over the server's current cap.
 * A chunk's `422` means its bytes contradict the session's type, and the server has discarded it.
 */
function endsSession(status: number, chunk: boolean): boolean {
  return status === 404 || status === 413 || (chunk && status === 422);
}

/**
 * Whether a status passes with time, so the same request may succeed when sent again.
 * A `501` stays final: the storage cannot resume, and no wait changes that.
 */
function isTransient(status: number): boolean {
  return TRANSIENT_STATUSES.has(status) || (status >= 500 && status !== 501);
}

/**
 * The route path of the session `session`.
 */
function sessionRoute(session: string): string {
  return `/uploads/sessions/${encodeURIComponent(session)}`;
}
