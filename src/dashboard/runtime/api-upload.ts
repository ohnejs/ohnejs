import type { APIRouteID } from './known-api-routes.ts';

import { untracked } from '../../utils/reactive/untracked.ts';
import { handleUnauthorized, requestTarget, withAcceptLanguage } from './_request.ts';
import { dashboardConfig } from './config.ts';
import { useDashboardLanguage } from './use-dashboard-language.ts';

/**
 * The bytes `apiUpload` sends, sent whole as the request body.
 * A `File` is a `Blob`, so a picked or dropped file passes as is.
 */
export type UploadBody = Blob | ArrayBuffer | Uint8Array<ArrayBuffer>;

/**
 * Options for `apiUpload`.
 */
export interface UploadOptions {
  /**
   * Called as the body goes out, with the bytes sent so far and the bytes to send in total.
   */
  onProgress?(loaded: number, total: number): void;

  /**
   * Aborts the request, as a signal aborts `fetch`.
   * The promise rejects with the signal's reason, an `AbortError` unless the abort named another.
   */
  signal?: AbortSignal;

  /**
   * Request headers, such as the body's `content-type`.
   */
  headers?: Record<string, string>;
}

/**
 * The statuses `Response` refuses a body for; the transport hands an empty buffer there, never `null`.
 */
const NULL_BODY_STATUSES = new Set([204, 205, 304]);

/**
 * Uploads a body to a route of the API the dashboard is configured for, reporting progress on the way.
 * `fetch` cannot report upload progress, so the request rides on `XMLHttpRequest` under `api`'s policy.
 * The route id's method sends the request; a bare path uploads with `POST`.
 * The path joins the base URL, credentials flow, and `401`s outside `/auth/` reach `setUnauthorizedHandler`.
 * `Accept-Language` names the dashboard language unless `headers` sets one.
 * Resolves a `Response` built from the answer, so it reads exactly like one from `api`.
 * Rejects like `fetch`: a `TypeError` when the request never completes, the signal's reason on abort.
 *
 * @example
 * ```ts
 * const percent = ref(0)
 *
 * async function send(file: File): Promise<void> {
 *   const response = await apiUpload(`POST /avatars?name=${encodeURIComponent(file.name)}`, file, {
 *     headers: { 'content-type': file.type },
 *     onProgress: (loaded, total) => (percent.value = Math.round((loaded / total) * 100)),
 *   })
 *   if (!response.ok) throw new Error((await response.json()).message)
 * }
 * ```
 */
export function apiUpload(
  route: APIRouteID,
  body: UploadBody,
  options: UploadOptions = {},
): Promise<Response> {
  const { onProgress, signal, headers } = options;
  if (signal?.aborted) return Promise.reject(signal.reason);
  const { method = 'POST', path, url } = requestTarget(dashboardConfig().apiURL, route);
  // Untracked: an upload started inside a render must not subscribe that region to the language.
  const language = untracked(() => useDashboardLanguage().value);
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open(method, url);
    xhr.withCredentials = true;
    xhr.responseType = 'arraybuffer';
    for (const [name, value] of withAcceptLanguage(headers, language)) {
      xhr.setRequestHeader(name, value);
    }
    const abort = (): void => xhr.abort();
    signal?.addEventListener('abort', abort);
    if (onProgress) {
      xhr.upload.addEventListener('progress', (event) => onProgress(event.loaded, event.total));
    }
    xhr.addEventListener('load', () => {
      handleUnauthorized(xhr.status, path);
      resolve(responseOf(xhr));
    });
    xhr.addEventListener('error', () => reject(new TypeError('Network request failed')));
    xhr.addEventListener('abort', () => reject(abortReason(signal)));
    xhr.addEventListener('loadend', () => signal?.removeEventListener('abort', abort));
    xhr.send(body);
  });
}

/**
 * A `Response` carrying what the request answered: status, headers, and the bytes.
 */
function responseOf(xhr: XMLHttpRequest): Response {
  const body = NULL_BODY_STATUSES.has(xhr.status) ? null : (xhr.response as ArrayBuffer);
  return new Response(body, {
    status: xhr.status,
    statusText: xhr.statusText,
    headers: parseResponseHeaders(xhr.getAllResponseHeaders()),
  });
}

/**
 * Parses the `name: value` lines of `getAllResponseHeaders()` into a `Headers`.
 */
function parseResponseHeaders(raw: string): Headers {
  const headers = new Headers();
  for (const line of raw.split('\r\n')) {
    const separator = line.indexOf(':');
    if (separator !== -1)
      headers.append(line.slice(0, separator), line.slice(separator + 1).trim());
  }
  return headers;
}

/**
 * What an aborted upload rejects with: the signal's reason, or a fresh `AbortError` when no signal asked.
 */
function abortReason(signal?: AbortSignal): unknown {
  return signal?.aborted
    ? signal.reason
    : new DOMException('The upload was aborted.', 'AbortError');
}
