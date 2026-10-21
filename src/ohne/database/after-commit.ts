import type { DatabaseAdapter, Transaction } from './adapter.ts';

import { isUndefined } from '../../utils/index.ts';

const queues = new WeakMap<Transaction, (() => Promise<void>)[]>();
const wrapped = new WeakMap<DatabaseAdapter, DatabaseAdapter>();

/**
 * Queues `fn` to run once `tx` commits, outside the transaction.
 * Returns `false` for a transaction no `committing` adapter opened, queueing nothing.
 */
export function afterCommit(tx: Transaction, fn: () => Promise<void>): boolean {
  const queue = queues.get(tx);
  queue?.push(fn);
  return !isUndefined(queue);
}

/**
 * Wraps `adapter` so every transaction it opens runs its `afterCommit` work, in order, once it commits.
 * A rollback drops the work; a failing step rejects the `transaction` call, though its rows stay committed.
 * One adapter gets one wrapper, and a wrapper wraps to itself.
 */
export function committing(adapter: DatabaseAdapter): DatabaseAdapter {
  const known = wrapped.get(adapter);
  if (!isUndefined(known)) return known;
  const wrapper: DatabaseAdapter = {
    exec: (sql) => adapter.exec(sql),
    run: (sql, params) => adapter.run(sql, params),
    query: (sql, params) => adapter.query(sql, params),
    queryOne: (sql, params) => adapter.queryOne(sql, params),
    close: () => adapter.close(),
    async transaction(fn, mode) {
      const queue: (() => Promise<void>)[] = [];
      const result = await adapter.transaction((tx) => {
        queues.set(tx, queue);
        return fn(tx);
      }, mode);
      for (const flush of queue) await flush();
      return result;
    },
  };
  wrapped.set(adapter, wrapper);
  wrapped.set(wrapper, wrapper);
  return wrapper;
}
