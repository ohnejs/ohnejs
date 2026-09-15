/**
 * A single value that can cross the driver boundary in either direction.
 * The dialect codec turns richer JS values like booleans and JSON into these primitives and back.
 * A large integer is carried as a `string` and ohne stores no binary, so the boundary needs nothing wider.
 */
export type SQLValue = null | number | string;

/**
 * Positional bind parameters for a parametrized statement.
 * Every placeholder is `?`; a dialect rewrites the style internally when its driver needs `$n`.
 */
export type SQLParams = readonly SQLValue[];

/**
 * How a transaction takes its write lock.
 *
 * `deferred` acquires nothing at `BEGIN`, escalating to the write lock on the first write.
 * `immediate` reserves the write lock at `BEGIN`, so cross-connection contention waits there.
 * It waits under the busy timeout instead of failing mid-transaction with a busy-snapshot.
 * Write terminals open `immediate`; reads and the default open `deferred`.
 */
export type TransactionMode = 'deferred' | 'immediate';

/**
 * A live database connection ohne speaks to.
 *
 * Async even over a synchronous driver, so the driver stays swappable behind the same surface.
 * Nothing outside a dialect implements this: the dialect's `connect` returns it.
 * Framework code speaks these methods and nothing driver-specific.
 */
export interface DatabaseAdapter {
  /**
   * Runs one or more statements carrying no bind parameters, returning nothing.
   * For DDL and pragmas, where there is no result set to read.
   *
   * @example
   * ```ts
   * await db.exec('CREATE TABLE posts (id TEXT PRIMARY KEY)')
   * ```
   */
  exec(sql: string): Promise<void>;

  /**
   * Runs a single write statement and reports how many rows it changed.
   *
   * @example
   * ```ts
   * const { changes } = await db.run('DELETE FROM posts WHERE id = ?', ['p1'])
   * changes // -> 1
   * ```
   */
  run(sql: string, params?: SQLParams): Promise<{ changes: number }>;

  /**
   * Runs a query and returns every row.
   *
   * @example
   * ```ts
   * await db.query<{ id: string }>('SELECT id FROM posts')
   * // -> [{ id: 'p1' }, { id: 'p2' }]
   * ```
   */
  query<T>(sql: string, params?: SQLParams): Promise<T[]>;

  /**
   * Runs a query and returns the first row, or `undefined` when there are none.
   *
   * @example
   * ```ts
   * await db.queryOne<{ id: string }>('SELECT id FROM posts WHERE id = ?', ['p1'])
   * // -> { id: 'p1' }
   * ```
   */
  queryOne<T>(sql: string, params?: SQLParams): Promise<T | undefined>;

  /**
   * Runs `fn` inside a transaction, committing its result or rolling back on a throw.
   * The dialect owns `BEGIN`/`COMMIT`/`ROLLBACK`; `fn` sees a `Transaction`, which cannot nest another.
   * Transactions on one connection serialize: a second call waits for the first to settle, never nesting.
   * `mode` picks how the transaction takes its write lock, `deferred` when omitted.
   *
   * @example
   * ```ts
   * await db.transaction(async (tx) => {
   *   await tx.run('INSERT INTO posts (id) VALUES (?)', ['p1'])
   *   await tx.run('INSERT INTO posts (id) VALUES (?)', ['p2'])
   * })
   * ```
   */
  transaction<T>(fn: (tx: Transaction) => Promise<T>, mode?: TransactionMode): Promise<T>;

  /**
   * Closes the connection and releases its handle.
   *
   * @example
   * ```ts
   * await db.close()
   * ```
   */
  close(): Promise<void>;
}

/**
 * The adapter surface available inside a `transaction`.
 * Everything the full adapter offers except opening a nested transaction or closing the connection.
 */
export type Transaction = Pick<DatabaseAdapter, 'exec' | 'run' | 'query' | 'queryOne'>;
