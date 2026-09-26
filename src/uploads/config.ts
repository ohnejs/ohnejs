import type { CacheControlOptions, LayerStrategies } from 'ohnejs/utils';

import { ohneError, useConfig, useEnv } from 'ohnejs';
import { formatBytes, parseBytes, parseDuration, withDefaults } from 'ohnejs/utils';
import { createCIDRMatcher } from 'ohnejs/utils/net';

import type { ImageTransforms } from './images/transforms.ts';

import { PEEK_SIZE } from './uploads/_peek.ts';

declare module 'ohnejs' {
  interface Config {
    /**
     * Settings for the uploads layer: where files live, what may be uploaded, and how files are served.
     */
    uploads?: {
      /**
       * The storage backend, by the name a boot file registered it under.
       *
       * - The layer ships `fs`, which keeps files on the local filesystem.
       * - `@ohnejs/uploads-s3` adds `s3`.
       *
       * @default
       * 'fs'
       */
      storage?: string;

      /**
       * Where the backend keeps the files, in whatever form the backend understands.
       *
       * - For `fs` it is a directory, resolved against the app root.
       * - For `s3` it is `s3://<bucket>/<prefix>`, with options in the query.
       *
       * The `UPLOADS_URL` env var takes precedence whenever it is set.
       *
       * @default
       * '.uploads'
       */
      url?: string;

      /**
       * The largest file an upload may carry, as a `parseBytes` value.
       *
       * @default
       * '128mb'
       */
      maxFileSize?: number | string;

      /**
       * The largest SVG an upload may carry, as a `parseBytes` value.
       * An SVG is sanitized whole in memory, and the API answers no other request while that runs.
       * Hostile markup takes about 120 ms per MiB, so a larger cap lets one upload stall the API for longer.
       *
       * @default
       * '2mb'
       */
      maxSVGSize?: number | string;

      /**
       * The size of every chunk of a resumable upload but the last, as a `parseBytes` value.
       * It is `64kb` or more, since the first chunk must hold the bytes a file's type is checked by.
       * Keep it under the body limit of any proxy in front of the API.
       * A file that fits one chunk goes up in one request.
       * An open session keeps the size it was given.
       * Lowering it ends an open session with a full chunk left, which the new cap refuses with `413`.
       *
       * @default
       * '8mb'
       */
      chunkSize?: number | string;

      /**
       * The media types that may be uploaded, or `'*'` for any.
       * A file's type comes from its extension and is verified against its bytes.
       *
       * @default
       * '*'
       */
      types?: '*' | string[];

      /**
       * The `Cache-Control` directives every served file carries.
       * The default revalidates on every use, so a renamed or replaced file is never stale.
       *
       * @default
       * { noCache: true }
       */
      cache?: CacheControlOptions;

      /**
       * An origin that serves the stored files by their path, such as a CDN in front of the storage.
       * Omitted, a backend that serves its files itself names the URL.
       * Failing that, the API serves every file itself at `/uploads/<path>`.
       */
      publicURL?: string;

      /**
       * How long a private file's links stay valid, as a `parseDuration` value.
       * Reads align links to these windows for browser caches, so a link lives one to two windows.
       *
       * @default
       * '1h'
       *
       * @example
       * ```ts
       * 3600000 // 1 hour, as raw milliseconds
       * '1h'    // 1 hour
       * ```
       */
      privateMaxAge?: number | string;

      /**
       * How long a resumable upload has from its first request to completion, as a `parseDuration` value.
       * A storage that expires unfinished writes on its own must outlive it.
       *
       * @default
       * '1d'
       */
      sessionMaxAge?: number | string;

      /**
       * The image optimization service that answers signed variant URLs, and the variants it renders.
       */
      images?: {
        /**
         * The service origin, the prefix of every variant URL.
         * Omitted, every image URL points at the original and no record carries `variants`.
         */
        url?: string;

        /**
         * Named transform presets, each a set of `ImageTransforms`.
         * A name is a camelCase identifier; `thumbnail` ships, and an app redefines it by name.
         * A redefinition replaces the preset whole.
         *
         * @default
         * { thumbnail: { width: 320, height: 320, fit: 'inside', format: 'webp' } }
         */
        variants?: Record<string, ImageTransforms>;
      };

      /**
       * How `POST /uploads/fetch` and `fetchUpload` fetch a file from a URL someone else chose.
       * It reaches only public addresses on ports 80 and 443, so a URL cannot probe the server's network.
       */
      fetch?: {
        /**
         * Addresses and CIDR blocks fetched although they are not public, on any port.
         * The way to fetch from an intranet, as `['10.20.0.0/16']` does.
         * `'0.0.0.0/0'` switches the guard off for IPv4, and `'::/0'` switches it off entirely.
         * Either one lets any editor who may fetch read the server's own network and cloud metadata.
         * A closer layer's list replaces an inherited one.
         *
         * @default
         * []
         */
        allow?: string[];

        /**
         * The deadline for one fetch, across its redirects and the whole body, as a `parseDuration` value.
         * Whatever it is, the source must start answering within 30 seconds and never go quiet for longer.
         *
         * @default
         * '2m'
         */
        timeout?: number | string;
      };
    };
  }

  interface KnownCapabilities {
    /**
     * Fetching a file from a URL into `Uploads`, alongside `collection.Uploads.create`.
     * The request leaves from the server's own address, which partners may trust, so a role grants it apart.
     */
    'uploads.fetch': true;
  }

  interface Env {
    /**
     * Overrides `uploads.url`, the storage location, whenever it is set.
     *
     * @default
     * undefined
     */
    UPLOADS_URL: string | undefined;

    /**
     * The secret that signs image variant URLs and a private file's expiring links.
     * The image service verifies with the same value.
     * Several secrets may be listed, comma-separated; the first signs, any verifies.
     * Unset, variant URLs read `unsigned` and a private file has no links and no variants.
     *
     * @default
     * undefined
     */
    UPLOADS_SECRET: string | undefined;
  }
}

/**
 * The resolved uploads settings: every `Config.uploads` field, with the layer defaults filled in.
 */
export interface ResolvedUploadsConfig {
  /**
   * The registered name of the storage backend.
   */
  storage: string;

  /**
   * Where the backend keeps the files.
   */
  url: string;

  /**
   * The largest file an upload may carry, as a `parseBytes` value.
   */
  maxFileSize: number | string;

  /**
   * The largest SVG an upload may carry, as a `parseBytes` value.
   */
  maxSVGSize: number | string;

  /**
   * The size of every chunk of a resumable upload but the last, as a `parseBytes` value.
   */
  chunkSize: number | string;

  /**
   * The media types that may be uploaded, or `'*'` for any.
   */
  types: '*' | string[];

  /**
   * The `Cache-Control` directives every served file carries.
   */
  cache: CacheControlOptions;

  /**
   * An origin that serves the stored files by their path, when one is configured.
   */
  publicURL?: string;

  /**
   * How long a private file's links stay valid, as a `parseDuration` value.
   */
  privateMaxAge: number | string;

  /**
   * How long a resumable upload has from its first request to completion, as a `parseDuration` value.
   */
  sessionMaxAge: number | string;

  /**
   * The image optimization service and the named variants it renders.
   */
  images: {
    /**
     * The service origin, when one is configured.
     */
    url?: string;

    /**
     * The named transform presets, the shipped `thumbnail` included.
     */
    variants: Record<string, ImageTransforms>;
  };

  /**
   * How a file is fetched from a URL.
   */
  fetch: {
    /**
     * Addresses and CIDR blocks fetched although they are not public.
     */
    allow: string[];

    /**
     * The deadline for one fetch, as a `parseDuration` value.
     */
    timeout: number | string;
  };
}

/**
 * The `Config.uploads` defaults, which `useUploadsConfig` fills in wherever config leaves a field unset.
 */
export const UPLOADS_DEFAULTS = {
  storage: 'fs',
  url: '.uploads',
  maxFileSize: '128mb',
  maxSVGSize: '2mb',
  chunkSize: '8mb',
  types: '*',
  cache: { noCache: true },
  privateMaxAge: '1h',
  sessionMaxAge: '1d',
  images: { variants: { thumbnail: { width: 320, height: 320, fit: 'inside', format: 'webp' } } },
  fetch: { allow: [], timeout: '2m' },
} satisfies ResolvedUploadsConfig;

/**
 * How the uploads keys merge, keyed by their path under `Config.uploads`.
 * `cache` replaces, so a configured policy never inherits the default `no-cache`.
 * `images.variants` assigns, so names union across layers and a redefined preset inherits nothing.
 * The layer's `ohne.layer.ts` declares the same strategies for the stack, prefixed with `uploads.`.
 */
export const UPLOADS_STRATEGIES: LayerStrategies = {
  cache: 'replace',
  'images.variants': 'assign',
};

useEnv().define('UPLOADS_URL', { default: undefined });
useEnv().define('UPLOADS_SECRET', { default: undefined });

/**
 * Returns the resolved uploads settings, `Config.uploads` merged over the layer defaults.
 * Valid wherever config is.
 */
export function useUploadsConfig(): ResolvedUploadsConfig {
  return withDefaults(useConfig().uploads ?? {}, UPLOADS_DEFAULTS, {
    strategies: UPLOADS_STRATEGIES,
  });
}

/**
 * Checks every uploads setting the layer parses, throwing an error block that names the first bad one.
 * Each is parsed per request, so one bad value would otherwise fail every upload or fetch with a `500`.
 * A boot file runs it, so the API server and every command stop before any request.
 */
export function validateUploadsConfig(): void {
  const config = useUploadsConfig();
  for (const entry of config.fetch.allow) {
    if (!parses(() => createCIDRMatcher([entry]))) {
      throw ohneError({
        title: `Invalid \`uploads.fetch.allow\` entry \`${entry}\``,
        body: [
          'An entry is an IP address or a CIDR block, such as `10.20.0.0/16` or `fd00::/8`.',
          'Fix or remove it under `uploads.fetch.allow`.',
        ],
      });
    }
  }
  const { maxFileSize, maxSVGSize, chunkSize, privateMaxAge, sessionMaxAge } = config;
  for (const [key, value] of Object.entries({ maxFileSize, maxSVGSize })) {
    if (!parses(() => parseBytes(value) > 0)) {
      throw invalidValue(
        key,
        value,
        'It is a byte size above zero, such as `2mb`, or a number of bytes.',
      );
    }
  }
  if (!parses(() => parseBytes(chunkSize) >= PEEK_SIZE)) {
    const min = formatBytes(PEEK_SIZE);
    throw invalidValue(
      'chunkSize',
      chunkSize,
      `It is a byte size of \`${min}\` or more, such as \`8mb\`, or a number of bytes.`,
    );
  }
  const durations = { privateMaxAge, sessionMaxAge, 'fetch.timeout': config.fetch.timeout };
  for (const [key, value] of Object.entries(durations)) {
    if (!parses(() => parseDuration(value) > 0)) {
      throw invalidValue(
        key,
        value,
        'It is a duration above zero, such as `2m`, or a number of milliseconds.',
      );
    }
  }
}

/**
 * Whether `parse` runs without throwing and returns anything but `false`.
 */
function parses(parse: () => unknown): boolean {
  try {
    return parse() !== false;
  } catch {
    return false;
  }
}

/**
 * The error block for an `uploads.<key>` setting whose `value` does not parse, with the `form` it takes.
 */
function invalidValue(key: string, value: number | string, form: string): Error {
  return ohneError({
    title: `Invalid \`uploads.${key}\` value \`${value}\``,
    body: [form, `Fix it under \`uploads.${key}\`.`],
  });
}
