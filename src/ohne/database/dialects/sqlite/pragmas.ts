import type { DatabaseSync } from 'node:sqlite';

/**
 * Applies ohne's SQLite pragmas to a freshly opened connection.
 *
 * The busy timeout comes first, because `journal_mode = WAL` writes the database header.
 * Without a handler installed, another process's write lock would fail the connect at once.
 * WAL with `synchronous = NORMAL` lets readers run concurrently with a writer.
 * It skips an fsync per commit, trading a crash's last few transactions for throughput.
 * Foreign keys on enforces relations, which SQLite leaves off by default.
 */
export function applyPragmas(db: DatabaseSync): void {
  db.exec('PRAGMA busy_timeout = 5000');
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA synchronous = NORMAL');
  db.exec('PRAGMA foreign_keys = ON');
}
