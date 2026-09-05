import type { CacheControlOptions } from 'ohne/utils';

import { useConfig, useEnv } from 'ohne';
import { withDefaults } from 'ohne/utils';

declare module 'ohne' {
  interface Config {
    /**
     * Settings for the uploads layer: where files live, what may be uploaded, and how files are served.
     */
    uploads?: {
      /**
       * The storage backend, by the name a boot file registered it under.
       * The layer ships `fs`, which keeps files on the local filesystem.
       *
       * @default
       * 'fs'
       */
      storage?: string;

      /**
       * Where the backend keeps the files, in whatever form the backend understands.
       * For `fs` it is a directory, resolved against the working directory.
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
       * Omitted, the API serves every file itself at `/uploads/<path>`.
       */
      publicURL?: string;

      /**
       * The image optimization service that answers signed variant URLs.
       * Omitted, every image URL points at the original.
       */
      images?: {
        /**
         * The service origin, the prefix of every variant URL.
         */
        url: string;
      };
    };
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
     * The secret that signs image variant URLs, shared with the image service.
     * Several secrets may be listed, comma-separated; the first signs, the service accepts any.
     *
     * @default
     * undefined
     */
    IMAGES_SECRET: string | undefined;
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
   * The image optimization service, when one is configured.
   */
  images?: {
    /**
     * The service origin.
     */
    url: string;
  };
}

/**
 * The uploads defaults the layer contributes through its `ohne.layer.ts`.
 * The single source `useUploadsConfig` also falls back to, so the framework's own repo resolves them too.
 */
export const UPLOADS_DEFAULTS = {
  storage: 'fs',
  url: '.uploads',
  maxFileSize: '128mb',
  types: '*',
  cache: { noCache: true },
} satisfies ResolvedUploadsConfig;

useEnv().define('UPLOADS_URL', { default: undefined, flag: 'value' });
useEnv().define('IMAGES_SECRET', { default: undefined });

/**
 * Returns the resolved uploads settings, `Config.uploads` merged over the layer defaults.
 * `cache` replaces rather than merges, so a configured policy never inherits the default `no-cache`.
 * Valid wherever config is, so the routes, helpers, and storage read one consistent shape.
 */
export function useUploadsConfig(): ResolvedUploadsConfig {
  const uploads = useConfig().uploads ?? {};
  return {
    ...withDefaults(uploads, UPLOADS_DEFAULTS),
    cache: uploads.cache ?? UPLOADS_DEFAULTS.cache,
  };
}
