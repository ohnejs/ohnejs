import type { Stats } from 'node:fs';

import { fingerprint } from '../../utils/crypto/fingerprint.ts';
import { findFile } from '../../utils/fs/find-file.ts';
import { listDir } from '../../utils/fs/list-dir.ts';
import { readFileBytes } from '../../utils/fs/read-file-bytes.ts';
import { parseImports } from '../../utils/imports/parse-imports.ts';
import { stripFile } from '../../utils/imports/strip-file.ts';
import {
  cacheControl,
  extname,
  isNull,
  isNullish,
  isString,
  isTypeScriptPath,
  isUndefined,
  mapConcurrent,
  mimeTypeFor,
  TYPESCRIPT_EXTENSIONS,
} from '../../utils/index.ts';
import { notFound } from '../http/http-error.ts';
import { isFresh } from '../http/is-fresh.ts';
import { sendNotModified } from '../http/send-not-modified.ts';
import { useEvent } from '../http/use-event.ts';

/**
 * A module stripped to JavaScript or a font as is, with its stats, its fingerprint and its specifiers.
 */
interface Entry {
  size: number;
  ctimeMs: number;
  settled: boolean;
  body: string | Uint8Array;
  hash: string;
  imports: string[];
}

/**
 * One served file a scan found: its URL and the file that wins it.
 */
interface Winner {
  url: string;
  path: string;
  stats: Stats;
}

/**
 * A URL prefix and the directories whose modules and fonts it serves.
 */
export interface ModuleMount {
  /**
   * The URL prefix the files are served under, like `/m/app`.
   */
  base: string;

  /**
   * Absolute directories, closest first.
   * The first one that holds a path serves it.
   */
  roots: string[];
}

/**
 * One module or font a scan found.
 */
export interface ScannedModule {
  /**
   * The file's URL with the fingerprint of the bytes it is served as, like `/m/app/nav.ts?h=47DEQpj8`.
   */
  hashed: string;

  /**
   * Every specifier a module's source names, verbatim; a font names none.
   * It over-captures: a specifier in a comment or a string counts too.
   */
  imports: string[];
}

/**
 * The dashboard's served modules and fonts, each named by a fingerprint of the bytes it is served as.
 * A module is served stripped to JavaScript; a font is served as is.
 */
export interface ModuleTable {
  /**
   * Re-lists every mount and fingerprints what changed since the last scan.
   * Resolves each module's served URL mapped to what the scan found.
   * A file the stripper rejects is left out, so it stays reachable at its plain URL.
   */
  scan(): Promise<Map<string, ScannedModule>>;

  /**
   * Serves the module or font at `path` in the first of `roots` that holds it, for the current request.
   * The response is cached for good only when the request's fingerprint names exactly these bytes.
   * Any other request gets the current bytes, revalidated on every use.
   */
  send(roots: readonly string[], path: string): Promise<string | Uint8Array | undefined>;
}

/**
 * The extensions of the font files the table fingerprints beside modules.
 * Their CSS resolves each URL through the importmap, so a font is cached for good as a module is.
 */
const FONT_EXTENSIONS = ['.woff2'];

/**
 * The query parameter that carries a file's fingerprint in its URL.
 */
const HASH_PARAM = 'h';

/**
 * How long a fingerprinted file stays fresh, in seconds: a year, since its URL names its bytes.
 */
const HASHED_MAX_AGE = 31_536_000;

/**
 * How many files a scan reads at once, well under the default open-file limit on macOS.
 */
const READ_CONCURRENCY = 32;

/**
 * How long after a file's last change, in milliseconds, its entry is read again on every use.
 * A same-size write within one coarse ctime tick keeps the stats, so a young entry proves nothing.
 */
const SETTLE_MS = 2000;

/**
 * The syntax errors `stripFile` throws for source it cannot erase to JavaScript.
 */
const STRIP_ERRORS = new Set([
  'ERR_INVALID_TYPESCRIPT_SYNTAX',
  'ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX',
]);

/**
 * Served modules and fonts by absolute file, shared by every table in the process.
 * Only files a scan listed are kept, so request paths cannot grow it.
 */
const entries = new Map<string, Entry>();

/**
 * Creates the module table for `mounts`.
 *
 * A scan lists each mount's roots, picks each path's winner the way a request does, and stats it.
 * An entry lives while size and ctime match, since tools that restore mtime cannot restore ctime.
 * Concurrent scans coalesce: a caller joins the next scan to start, never one already running.
 * So a scan always begins after its caller arrived and sees every change made before.
 */
export function createModuleTable(mounts: readonly ModuleMount[]): ModuleTable {
  let running: Promise<Map<string, ScannedModule>> | undefined;
  let queued: Promise<Map<string, ScannedModule>> | undefined;
  let owned = new Set<string>();

  const start = (): Promise<Map<string, ScannedModule>> => {
    running = rescan().finally(() => (running = undefined));
    return running;
  };

  const next = (): Promise<Map<string, ScannedModule>> => {
    queued = undefined;
    return start();
  };

  async function rescan(): Promise<Map<string, ScannedModule>> {
    const winners = (await Promise.all(mounts.map(listWinners))).flat();
    const built = await mapConcurrent(winners, READ_CONCURRENCY, (winner) =>
      buildListed(winner.path, winner.stats),
    );

    const scanned = new Map<string, ScannedModule>();
    const kept = new Set<string>();
    winners.forEach((winner, index) => {
      const entry = built[index];
      if (isNullish(entry)) return;
      kept.add(winner.path);
      const hashed = `${winner.url}?${HASH_PARAM}=${entry.hash}`;
      scanned.set(winner.url, { hashed, imports: entry.imports });
    });
    for (const file of owned) if (!kept.has(file)) entries.delete(file);
    owned = kept;
    return scanned;
  }

  return {
    scan: () => queued ?? (isUndefined(running) ? start() : (queued = running.then(next, next))),
    send,
  };
}

/**
 * Lists every module path under `mount` and resolves each to the file a request for it is served from.
 */
async function listWinners(mount: ModuleMount): Promise<Winner[]> {
  const listings = await Promise.all(
    mount.roots.map((root) =>
      listDir(root, { ext: [...TYPESCRIPT_EXTENSIONS, ...FONT_EXTENSIONS] }),
    ),
  );
  const paths = new Set(
    listings.flatMap((listing) => listing ?? []).map((entry) => entry.relativePath),
  );
  const winners = await Promise.all(
    [...paths].map(async (path) => {
      const found = await findFile(mount.roots, path);
      return isNull(found) ? null : { url: `${mount.base}/${path}`, ...found };
    }),
  );
  return winners.filter((winner) => !isNull(winner));
}

/**
 * The current entry for a listed `file`, kept for later use; `null` when it vanished or fails to strip.
 */
async function buildListed(file: string, stats: Stats): Promise<Entry | null> {
  try {
    return await entryFor(file, stats, true);
  } catch (error) {
    if (STRIP_ERRORS.has((error as NodeJS.ErrnoException).code ?? '')) return null;
    throw error;
  }
}

/**
 * The entry for `file` as `stats` describe it, reusing the kept one while it still matches.
 * A rebuilt entry replaces the kept one only when `keep` is set.
 */
async function entryFor(file: string, stats: Stats, keep: boolean): Promise<Entry | null> {
  const cached = entries.get(file);
  if (
    !isUndefined(cached) &&
    cached.settled &&
    cached.size === stats.size &&
    cached.ctimeMs === stats.ctimeMs
  ) {
    return cached;
  }

  const body = isTypeScriptPath(file) ? await stripFile(file) : await readFileBytes(file);
  if (isNull(body)) return null;
  const entry: Entry = {
    size: stats.size,
    ctimeMs: stats.ctimeMs,
    settled: Date.now() - stats.ctimeMs > SETTLE_MS,
    body,
    hash: fingerprint(body),
    imports: isString(body) ? parseImports(body) : [],
  };
  if (keep) entries.set(file, entry);
  return entry;
}

/**
 * Serves the file at `path` in the first of `roots`, immutable only when the request's fingerprint matches.
 * A path no scan listed, like another spelling on a case-insensitive disk, is served without being kept.
 */
async function send(
  roots: readonly string[],
  path: string,
): Promise<string | Uint8Array | undefined> {
  const found = await findFile(roots, path);
  const entry = isNull(found)
    ? null
    : await entryFor(found.path, found.stats, entries.has(found.path));
  if (isNull(entry)) throw notFound('Not Found');

  const { url, response } = useEvent();
  const hashed = url.searchParams.get(HASH_PARAM) === entry.hash;
  response.headers.set(
    'content-type',
    mimeTypeFor(isString(entry.body) ? 'js' : path) ?? 'text/plain; charset=utf-8',
  );
  response.headers.set('etag', `"${entry.hash}"`);
  response.headers.set(
    'cache-control',
    cacheControl(
      hashed ? { public: true, maxAge: HASHED_MAX_AGE, immutable: true } : { noCache: true },
    ),
  );

  if (isFresh()) {
    sendNotModified();
    return undefined;
  }
  return entry.body;
}

/**
 * Whether the table serves `path`: a TypeScript module or a font file.
 */
export function isFingerprinted(path: string): boolean {
  return isTypeScriptPath(path) || FONT_EXTENSIONS.includes(extname(path));
}
