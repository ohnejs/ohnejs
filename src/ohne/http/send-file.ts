import { stripTypeScriptTypes } from 'node:module';
import { pathToFileURL } from 'node:url';

import { etag } from '../../utils/etag/etag.ts';
import { readFile } from '../../utils/fs/read-file.ts';
import {
  cacheControl,
  type CacheControlOptions,
  isNull,
  mimeTypeFor,
  safeResolve,
} from '../../utils/index.ts';
import { notFound } from './http-error.ts';
import { isFresh } from './is-fresh.ts';
import { sendNotModified } from './send-not-modified.ts';
import { useResponse } from './use-response.ts';

const TYPESCRIPT = /\.m?ts$/;
const JAVASCRIPT = 'text/javascript; charset=utf-8';

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
 * Serves a UTF-8 file from the first of `roots` that contains it, for the current request.
 *
 * `path` is resolved against each root and confined to it, so `..` and absolute paths cannot escape.
 * The first existing file wins; a missing path or a directory is a miss, and no match throws `404`.
 *
 * A TypeScript file (`.ts`/`.mts`) is stripped to JavaScript on the fly and served as a module.
 * This is the stripping Node uses to run `.ts`, pointed at the browser.
 * Any other file is served with the content type for its extension.
 *
 * The body is tagged with a strong `ETag`, so a fresh request is answered `304`.
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
): Promise<string | undefined> {
  for (const root of roots) {
    const resolved = safeResolve(root, path);
    if (isNull(resolved)) continue;
    let source: string | null;
    try {
      source = await readFile(resolved);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EISDIR') throw error;
      continue;
    }
    if (isNull(source)) continue;
    return serve(resolved, source, options);
  }
  throw notFound(options.notFound);
}

function serve(file: string, source: string, options: SendFileOptions): string | undefined {
  const typescript = TYPESCRIPT.test(file);
  const body = typescript
    ? stripTypeScriptTypes(source, { sourceUrl: pathToFileURL(file).href })
    : source;

  const response = useResponse();
  response.headers.set(
    'content-type',
    typescript ? JAVASCRIPT : (mimeTypeFor(file) ?? 'text/plain; charset=utf-8'),
  );
  response.headers.set('etag', etag(body));
  response.headers.set('cache-control', cacheControl(options.cache ?? { noCache: true }));

  if (isFresh()) {
    sendNotModified();
    return undefined;
  }
  return body;
}
