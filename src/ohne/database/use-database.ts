import type { DatabaseAdapter } from './adapter.ts';
import type { DatabaseName } from './known-databases.ts';

import { createRegistry, isUndefined, type Registry } from '../../utils/index.ts';
import { ohneError } from '../error/ohne-error.ts';

let mainConnection: DatabaseAdapter | undefined;
const helperConnections: Registry<DatabaseAdapter> = createRegistry<DatabaseAdapter>();

/**
 * Registers an open connection: the main one when `name` is omitted, a helper under `name` otherwise.
 * `connect` calls this after opening; re-registering replaces, so a re-synced connection swaps in cleanly.
 */
export function registerDatabase(adapter: DatabaseAdapter, name?: string): void {
  if (isUndefined(name)) mainConnection = adapter;
  else helperConnections.register(name, adapter);
}

/**
 * Forgets every registered connection without closing it.
 * `connect` calls this before opening, so a re-run (a dev respawn) starts from a clean slate.
 */
export function clearDatabases(): void {
  mainConnection = undefined;
  helperConnections.clear();
}

/**
 * Returns the main database connection, or a named helper.
 *
 * `useDatabase()` is the main connection; `useDatabase('rateLimit')` a helper declared in `database.helpers`.
 * Both expose the same `DatabaseAdapter`.
 * Throws when the database is not connected or the helper is unknown.
 *
 * @example
 * ```ts
 * await useDatabase().query('SELECT 1')
 * await useDatabase('rateLimit').run('DELETE FROM hits')
 * ```
 */
export function useDatabase(name?: DatabaseName): DatabaseAdapter {
  if (isUndefined(name)) {
    if (isUndefined(mainConnection)) throw ohneError('The database is not connected');
    return mainConnection;
  }
  const helper = helperConnections.get(name);
  if (isUndefined(helper)) throw ohneError(`Unknown database helper \`${name}\``);
  return helper;
}
