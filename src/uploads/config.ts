import type { CacheControlOptions, LayerStrategies } from 'ohnejs/utils';

import { useConfig, useEnv } from 'ohnejs';
import { withDefaults } from 'ohnejs/utils';

import type { ImageTransforms } from './images/transforms.ts';

declare module 'ohnejs' {
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
       * Omitted, a backend that serves its files itself names the URL.
       * Failing that, the API serves every file itself at `/uploads/<path>`.
       */
      publicURL?: string;

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
         * A redefinition replaces the preset whole, so it inherits nothing from the layer beneath.
         *
         * @default
         * { thumbnail: { width: 320, height: 320, fit: 'inside', format: 'webp' } }
         */
        variants?: Record<string, ImageTransforms>;
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
  images: { variants: { thumbnail: { width: 320, height: 320, fit: 'inside', format: 'webp' } } },
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

useEnv().define('UPLOADS_URL', { default: undefined, flag: 'value' });
useEnv().define('IMAGES_SECRET', { default: undefined });

/**
 * Returns the resolved uploads settings, `Config.uploads` merged over the layer defaults.
 * The merge follows `UPLOADS_STRATEGIES`, so it reads the same whether or not the layer stack is loaded.
 * Valid wherever config is, so the routes, helpers, and storage read one consistent shape.
 */
export function useUploadsConfig(): ResolvedUploadsConfig {
  return withDefaults(useConfig().uploads ?? {}, UPLOADS_DEFAULTS, {
    strategies: UPLOADS_STRATEGIES,
  });
}
