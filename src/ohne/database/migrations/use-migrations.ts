import type { Migration } from './define-migration.ts';

import { createRegistry, type Registry } from '../../../utils/index.ts';

/**
 * One registered migration: its definition and where it came from.
 */
export interface MigrationMeta {
  /**
   * The identity the migration is stamped under: `<layer>/<filename>` without the extension.
   */
  name: string;

  /**
   * The migration definition.
   */
  migration: Migration;

  /**
   * Absolute path of the file that default-exports the definition.
   */
  file: string;
}

const registry: Registry<MigrationMeta> = createRegistry<MigrationMeta>();

/**
 * Returns the process-wide migration registry, keyed by migration name.
 *
 * Generated code registers every layer's migrations in execution order.
 * That order is furthest layer first, file name order within a layer.
 * The registry keeps insertion order, so its keys are the order the sync runs them in.
 *
 * @example
 * ```ts
 * useMigrations().keys()
 * // -> ['ohnejs/2026-07-draft-flag', 'app/2026-08-articles']
 * ```
 */
export function useMigrations(): Registry<MigrationMeta> {
  return registry;
}
