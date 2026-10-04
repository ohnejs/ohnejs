import type { Event } from '../http/event.ts';
import type { DatabaseAdapter } from './adapter.ts';
import type { Dialect } from './dialect.ts';
import type { DatabaseName } from './known-databases.ts';

import { createRegistry, isUndefined, type Registry } from '../../utils/index.ts';
import { ohneError } from '../error/ohne-error.ts';
import { tryUseEvent, useEvent } from '../http/use-event.ts';

let mainConnection: DatabaseAdapter | undefined;
let activeDialect: Dialect | undefined;
const helperConnections: Registry<DatabaseAdapter> = createRegistry<DatabaseAdapter>();
const boundConnections = new WeakMap<Event, DatabaseAdapter>();

/**
 * Registers an open connection: the main one when `name` is omitted, a helper under `name` otherwise.
 * `connect` calls this after opening; re-registering replaces, so a re-synced connection swaps in cleanly.
 */
export function registerDatabase(adapter: DatabaseAdapter, name?: string): void {
  if (isUndefined(name)) mainConnection = adapter;
  else helperConnections.register(name, adapter);
}

/**
 * Records the dialect the open connections speak.
 * `connect` calls this after resolving it from `database.dialect`.
 */
export function registerDialect(dialect: Dialect): void {
  activeDialect = dialect;
}

/**
 * Forgets every registered connection and the dialect without closing anything.
 * `connect` calls this before opening, so a re-run (a dev respawn) starts from a clean slate.
 */
export function clearDatabases(): void {
  mainConnection = undefined;
  activeDialect = undefined;
  helperConnections.clear();
}

/**
 * Closes the main connection and every helper, then forgets them.
 * The caller sequences it after the server drain, so in-flight requests never see a closed database.
 */
export async function closeDatabases(): Promise<void> {
  const open = [mainConnection, ...Object.values(helperConnections.all())];
  clearDatabases();
  for (const connection of open) {
    if (!isUndefined(connection)) await connection.close();
  }
}

/**
 * Binds `adapter` as the main database for the rest of the current request.
 * Every `useDatabase()` without a name then answers it, however deep the call, `waitUntil` work included.
 * Helpers and the dialect stay process-wide, so `useDatabase('cache')` and `useDialect()` are unchanged.
 * The `response:send` and `request:complete` hooks run outside the request, so they see the main connection.
 * The adapter must hold the synced schema, such as a file `ohne sync` built with `DATABASE` pointing at it.
 * Throws when called outside a request.
 *
 * @example
 * ```ts
 * // middleware/global/tenant.ts
 * import { bindDatabase, defineMiddleware } from 'ohnejs'
 *
 * export default defineMiddleware(async () => {
 *   bindDatabase(await tenantDatabase())
 * })
 * ```
 */
export function bindDatabase(adapter: DatabaseAdapter): void {
  boundConnections.set(useEvent(), adapter);
}

/**
 * Returns the main database connection, or a named helper.
 *
 * `useDatabase()` is the main connection; `useDatabase('cache')` a helper declared in `database.helpers`.
 * Inside a request that called `bindDatabase`, `useDatabase()` answers the bound adapter instead.
 * Both expose the same `DatabaseAdapter`.
 * Throws when the database is not connected or the helper is unknown.
 *
 * @example
 * ```ts
 * await useDatabase().query('SELECT 1')
 * await useDatabase('cache').run('DELETE FROM entries')
 * ```
 */
export function useDatabase(name?: DatabaseName): DatabaseAdapter {
  if (isUndefined(name)) {
    const event = tryUseEvent();
    const bound = isUndefined(event) ? undefined : boundConnections.get(event);
    if (!isUndefined(bound)) return bound;
    if (isUndefined(mainConnection)) throw ohneError('The database is not connected');
    return mainConnection;
  }
  const helper = helperConnections.get(name);
  if (isUndefined(helper)) throw ohneError(`Unknown database helper \`${name}\``);
  return helper;
}

/**
 * Returns the dialect of the open connections, resolved by `connect` from `database.dialect`.
 * Throws when the database is not connected.
 *
 * @example
 * ```ts
 * useDialect().quote('Posts') // -> '"Posts"'
 * ```
 */
export function useDialect(): Dialect {
  if (isUndefined(activeDialect)) throw ohneError('The database is not connected');
  return activeDialect;
}

/**
 * Returns the active dialect, or `undefined` when the database is not connected.
 * For code that runs both inside and outside a connection, like resolving guards before a request.
 */
export function tryUseDialect(): Dialect | undefined {
  return activeDialect;
}
