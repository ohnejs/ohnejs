import type { Stats } from 'node:fs';

import { etag } from '../../utils/etag/etag.ts';
import { findFile } from '../../utils/fs/find-file.ts';
import { readFileBytes } from '../../utils/fs/read-file-bytes.ts';
import { stripFile } from '../../utils/imports/strip-file.ts';
import {
  cacheControl,
  type CacheControlOptions,
  isNull,
  isTypeScriptPath,
  mimeTypeFor,
} from '../../utils/index.ts';
import { notFound } from './http-error.ts';
import { isFresh } from './is-fresh.ts';
import { sendNotModified } from './send-not-modified.ts';
import { useResponse } from './use-response.ts';

/**
 * Options for `sendFile`.
 */
export interface SendFileOptions {
  /**
   * Cache-Control directives for the response.
   *
   * @default
   * { noCache: true }
   */
  cache?: CacheControlOptions;

  /**
   * Message for the `404` thrown when no root contains the file.
   * Omitted falls back to the translated `api.http.notFound`.
   */
  notFound?: string;
}

/**
 * Serves a file from the first of `roots` that contains it, for the current request.
 *
 * `path` is resolved against each root and confined to it, so `..` and absolute paths cannot escape.
 * The first existing file wins; a missing path or a directory is a miss, and no match throws `404`.
 *
 * A TypeScript file (`.ts`/`.mts`) is stripped to JavaScript on the fly and served as a module.
 * This is the stripping Node uses to run `.ts`, pointed at the browser.
 * Any other file is served verbatim as bytes with the content type for its extension.
 * Binary assets like fonts and images pass through intact.
 *
 * The response carries a weak `ETag` from the file's size and modification time, so a fresh request is `304`.
 * A fresh request short-circuits on the stat alone: the file is neither read nor stripped.
 * Call it inside a request and return its result as the handler body.
 *
 * @example
 * ```ts
 * // GET /m/[...path]
 * export default defineHandler(({ params }) => sendFile([srcRoot], params.path))
 * ```
 */
export async function sendFile(
  roots: string[],
  path: string,
  options: SendFileOptions = {},
): Promise<string | Uint8Array | undefined> {
  const found = await findFile(roots, path);
  if (isNull(found)) throw notFound(options.notFound);
  return serve(found.path, found.stats, options);
}

/**
 * Sets the file's headers, then marks a fresh request `304` or returns the body, stripped when TypeScript.
 */
async function serve(
  file: string,
  stats: Stats,
  options: SendFileOptions,
): Promise<string | Uint8Array | undefined> {
  const typescript = isTypeScriptPath(file);

  const response = useResponse();
  response.headers.set(
    'content-type',
    mimeTypeFor(typescript ? 'js' : file) ?? 'text/plain; charset=utf-8',
  );
  response.headers.set('etag', etag(stats));
  response.headers.set('cache-control', cacheControl(options.cache ?? { noCache: true }));

  if (isFresh()) {
    sendNotModified();
    return undefined;
  }

  if (typescript) return (await stripFile(file)) ?? '';
  return (await readFileBytes(file)) ?? new Uint8Array();
}
