import type { DatabaseSync } from 'node:sqlite';

/**
 * Applies ohne's SQLite pragmas to a freshly opened connection.
 *
 * WAL with `synchronous = NORMAL` lets readers run concurrently with a writer.
 * It skips an fsync per commit, trading a crash's last few transactions for throughput.
 * Foreign keys on enforces relations, which SQLite leaves off by default.
 * A busy timeout makes a writer wait out WAL contention instead of failing at once.
 * Multi-process access needs it.
 */
export function applyPragmas(db: DatabaseSync): void {
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA synchronous = NORMAL');
  db.exec('PRAGMA foreign_keys = ON');
  db.exec('PRAGMA busy_timeout = 5000');
}
