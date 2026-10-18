import type { Dialect } from './dialect.ts';

import { createRegistry, type Registry } from '../../utils/index.ts';
import { SQLiteDialect } from './dialects/sqlite/dialect.ts';

const registry: Registry<Dialect> = createRegistry<Dialect>();
registry.register('sqlite', new SQLiteDialect());

/**
 * Returns the process-wide dialect registry, keyed by dialect name.
 *
 * ohne's built-in `sqlite` is registered here, so the database works without the `ohnejs/base` layer.
 * A dialect layer registers its own from a boot file.
 * It augments `KnownDialects` in a separate file that imports no driver, so apps type-check without one.
 * `Config.database.dialect` selects one by name; unset, the first that accepts the URL wins.
 * Registering an existing name overrides it, so a dialect from a closer layer wins.
 *
 * @example
 * ```ts
 * // in a dialect layer's boot/ file
 * useDialects().register('postgres', new PostgresDialect())
 *
 * // in a driver-free file of the same layer
 * declare module 'ohnejs' {
 *   interface KnownDialects {
 *     postgres: true
 *   }
 * }
 * ```
 */
export function useDialects(): Registry<Dialect> {
  return registry;
}
