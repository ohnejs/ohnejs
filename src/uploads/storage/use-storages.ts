import type { Registry } from 'ohnejs/utils';

import { useEnv } from 'ohnejs';
import { createRegistry, isUndefined } from 'ohnejs/utils';

import type { StorageAdapter, StorageFactory } from './adapter.ts';

import { ohneError } from '../../ohne/error/ohne-error.ts';
import { useUploadsConfig } from '../config.ts';

const registry: Registry<StorageFactory> = createRegistry<StorageFactory>();

const adapters = new Map<string, StorageAdapter>();

/**
 * Returns the process-wide storage registry, keyed by backend name.
 *
 * The layer registers `fs` from its boot file; a backend layer registers its own the same way.
 * `Config.uploads.storage` selects one by name.
 * Registering an existing name overrides it, so a backend from a closer layer wins.
 *
 * @example
 * ```ts
 * // in a storage layer's boot/ file
 * useStorages().register('s3', (url) => createS3Storage(url))
 * ```
 */
export function useStorages(): Registry<StorageFactory> {
  return registry;
}

/**
 * Returns the storage backend the config selects, built once per backend name and location.
 * The location is `UPLOADS_URL` when set, else `uploads.url`.
 * Throws when `uploads.storage` names a backend no boot file registered.
 *
 * @example
 * ```ts
 * await useStorage().stat('photos/sunset.jpg') // -> { size: 48213 } | null
 * ```
 */
export function useStorage(): StorageAdapter {
  const { storage, url } = useUploadsConfig();
  const location = useEnv().get('UPLOADS_URL') ?? url;
  const key = `${storage}\0${location}`;
  const cached = adapters.get(key);
  if (!isUndefined(cached)) return cached;

  const factory = registry.get(storage);
  if (isUndefined(factory)) {
    throw ohneError({
      title: `Unknown storage \`${storage}\``,
      body: [
        `\`uploads.storage\` names a backend no boot file registered.`,
        `The uploads layer ships \`fs\`; a storage layer registers its own with \`useStorages()\`.`,
      ],
    });
  }
  const adapter = factory(location);
  adapters.set(key, adapter);
  return adapter;
}
