import type { Dialect } from './dialect.ts';

import { createRegistry, type Registry } from '../../utils/index.ts';
import { SQLiteDialect } from './dialects/sqlite/dialect.ts';

const registry: Registry<Dialect> = createRegistry<Dialect>();
registry.register('sqlite', new SQLiteDialect());

/**
 * Returns the process-wide dialect registry, keyed by dialect name.
 *
 * ohne's built-in `sqlite` is registered here, so the database works even with the ohne layer opted out.
 * A dialect layer registers its own from a boot file that also augments `KnownDialects`.
 * `Config.database.dialect` selects one by name.
 * Registering an existing name overrides it, so a dialect from a closer layer wins.
 *
 * @example
 * ```ts
 * // in a dialect layer's boot/ file
 * declare module 'ohnejs' {
 *   interface KnownDialects {
 *     postgres: true
 *   }
 * }
 *
 * useDialects().register('postgres', new PostgresDialect())
 * ```
 */
export function useDialects(): Registry<Dialect> {
  return registry;
}
