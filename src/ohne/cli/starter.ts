import { openAsBlob } from 'node:fs';
import { promisify } from 'node:util';
import { gunzip } from 'node:zlib';

import type { TarEntry } from '../../utils/index.ts';
import type { BlockOptions } from '../../utils/print/index.ts';

import { codeSpan } from '../../utils/ansi/index.ts';
import { ensureDir, writeFile } from '../../utils/fs/index.ts';
import {
  decodeText,
  errorMessage,
  formatBytes,
  isNull,
  isPrerelease,
  isUndefined,
  limitStream,
  parseBytes,
  readTar,
  safeResolve,
} from '../../utils/index.ts';
import { isOhneError, ohneError } from '../error/ohne-error.ts';
import { version } from '../meta/version.ts';
import { sessionCookie } from './session-cookie.ts';

const unzip = promisify(gunzip);

const COMPRESSED = parseBytes('5mb');

const UNPACKED = parseBytes('20mb');

const RETRY = 'Check your connection and run it again.';

const BACKEND_CONFIG = 'apps/backend/ohne.config.ts';

/**
 * Why `--web` cannot run with this package manager and `ohnejs` version, or `undefined` when it can.
 * The starters are pnpm workspaces, and only a stable `ohnejs` has a starter tag to scaffold from.
 *
 * @example
 * ```ts
 * webRefusal('npm', '0.5.0')          // -> { title: 'A website needs pnpm', ... }
 * webRefusal(undefined, '0.5.0-rc.1') // -> { title: 'Website starters follow stable releases', ... }
 * webRefusal('pnpm', '0.5.0')         // -> undefined
 * ```
 */
export function webRefusal(pm: string | undefined, ohne: string): BlockOptions | undefined {
  if (pm === 'npm') {
    return {
      title: 'A website needs pnpm',
      body: ['The starters are pnpm workspaces.', '', 'Run it again without `--pm npm`.'],
    };
  }
  if (isPrerelease(ohne)) {
    return {
      title: 'Website starters follow stable releases',
      body: 'Run `pnpm create ohne@latest` for a website.',
    };
  }
  return undefined;
}

/**
 * The files of a website starter at this `ohnejs` version, its top folder stripped.
 * It downloads the starter repo's `ohne-v<version>` tag, or reads a local `tarball` instead, for tests.
 * An archive over 5mb, or over 20mb unpacked, is refused.
 *
 * @example
 * ```ts
 * await readStarter('nuxt') // -> [{ path: 'package.json', type: 'file', data: Uint8Array(312) }, ...]
 * ```
 */
export async function readStarter(web: 'nuxt' | 'next', tarball?: string): Promise<TarEntry[]> {
  const tooLarge = (): Error =>
    ohneError({
      title: `The \`${web}\` starter is too large`,
      body: [
        `A starter stays under \`${formatBytes(COMPRESSED)}\`, and \`${formatBytes(UNPACKED)}\` unpacked.`,
      ],
    });
  const body = isUndefined(tarball) ? await download(web) : (await openAsBlob(tarball)).stream();

  let compressed: Uint8Array;
  try {
    compressed = await new Response(limitStream(body, COMPRESSED, tooLarge)).bytes();
  } catch (error) {
    if (isOhneError(error)) throw error;
    throw downloadFailed(web, errorMessage(error));
  }

  let entries: TarEntry[];
  try {
    entries = readTar(await unzip(compressed, { maxOutputLength: UNPACKED }));
  } catch (error) {
    if (error instanceof RangeError) throw tooLarge();
    throw ohneError({
      title: `The \`${web}\` starter is not a valid archive`,
      body: [errorMessage(error)],
    });
  }

  return entries.flatMap((entry) => {
    const slash = entry.path.indexOf('/');
    return slash === -1 ? [] : [{ ...entry, path: entry.path.slice(slash + 1) }];
  });
}

/**
 * Writes a starter's files under `target` and names its root package `name`.
 * It drops `minimumReleaseAgeExclude` from `pnpm-workspace.yaml`, so you keep pnpm's full age gate.
 * The backend's config names its session cookie after the project.
 * Every other file is written byte for byte.
 *
 * @example
 * ```ts
 * await writeStarter('/home/you/my-site', 'my-site', await readStarter('nuxt'))
 * ```
 */
export async function writeStarter(
  target: string,
  name: string,
  entries: TarEntry[],
): Promise<void> {
  for (const entry of entries) {
    const path = safeResolve(target, entry.path);
    if (isNull(path))
      throw ohneError(`The starter path ${codeSpan(entry.path)} leaves the project`);
    if (entry.type === 'directory') await ensureDir(path);
    else if (entry.path === 'package.json') await writeFile(path, renamed(entry.data, name));
    else if (entry.path === 'pnpm-workspace.yaml') await writeFile(path, ageGated(entry.data));
    else if (entry.path === BACKEND_CONFIG) await writeFile(path, withCookie(entry.data, name));
    else await writeFile(path, entry.data);
  }
}

/**
 * The response body of the starter's tag archive on GitHub.
 */
async function download(web: 'nuxt' | 'next'): Promise<ReadableStream<Uint8Array>> {
  const tag = `ohne-v${version}`;
  const url = `https://codeload.github.com/ohnejs/${web}-starter/tar.gz/refs/tags/${tag}`;
  let response: Response;
  try {
    response = await fetch(url, { signal: AbortSignal.timeout(30_000) });
  } catch (error) {
    throw downloadFailed(
      web,
      errorMessage(error instanceof Error ? (error.cause ?? error) : error),
    );
  }
  if (response.status === 404) {
    throw ohneError({
      title: `The \`${web}\` starter has no \`${tag}\` tag`,
      body: [
        `Its tags are at \`https://github.com/ohnejs/${web}-starter/tags\`.`,
        '',
        'Run `pnpm create ohne@latest` to scaffold from the newest release.',
      ],
    });
  }
  if (!response.ok || isNull(response.body)) {
    throw downloadFailed(web, `GitHub answered \`${response.status}\`.`);
  }
  return response.body;
}

/**
 * The failure of a starter download, with its `cause` and a retry hint.
 */
function downloadFailed(web: 'nuxt' | 'next', cause: string): Error {
  return ohneError({
    title: `Could not download the \`${web}\` starter`,
    body: [cause, '', RETRY],
  });
}

/**
 * The root `package.json` with its `name` set.
 */
function renamed(data: Uint8Array, name: string): string {
  return `${JSON.stringify(Object.assign(JSON.parse(decodeText(data)), { name }), null, 2)}\n`;
}

/**
 * The backend's config with its session cookie named after the project, after its `layers` line.
 * A config without that line is left as it is.
 */
function withCookie(data: Uint8Array, name: string): string {
  const lines = decodeText(data).split('\n');
  const at = lines.findIndex((line) => /^  layers: \[.*\],$/.test(line));
  if (at === -1) return lines.join('\n');
  lines.splice(
    at + 1,
    0,
    '  // Two apps on one host share cookies, so each names its own session cookie.',
    `  auth: { cookieName: '${sessionCookie(name)}' },`,
  );
  return lines.join('\n');
}

/**
 * `pnpm-workspace.yaml` without its top-level `minimumReleaseAgeExclude` block and the blank line it leaves.
 */
function ageGated(data: Uint8Array): string {
  const lines = decodeText(data).split('\n');
  let start = lines.findIndex((line) => /^minimumReleaseAgeExclude\s*:/.test(line));
  if (start === -1) return lines.join('\n');
  let end = start + 1;
  while (end < lines.length && /^[\s-]/.test(lines[end]!)) end++;
  const blankBefore = start === 0 || lines[start - 1] === '';
  const blankAfter = end === lines.length || lines[end] === '';
  if (blankBefore && blankAfter && start > 0) start--;
  else if (blankBefore && blankAfter && end < lines.length) end++;
  lines.splice(start, end - start);
  return lines.join('\n');
}
