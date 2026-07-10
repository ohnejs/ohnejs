import type { GuardReport } from './schema/guard.ts';

import { useCollections } from '../collections/use-collections.ts';
import { useEnv } from '../env/use-env.ts';
import { useFields } from '../fields/use-fields.ts';
import { useConfig } from '../layers/use-config.ts';
import { usePrinter } from '../printer/use-printer.ts';
import { connect } from './connect.ts';
import { useMigrations } from './migrations/use-migrations.ts';
import { buildDesiredSchema } from './schema/desired.ts';
import { syncDatabase } from './schema/sync.ts';
import { useDatabase } from './use-database.ts';

/**
 * Options for `syncProjectDatabase`.
 */
export interface SyncProjectOptions {
  /**
   * Authorizes destructive findings and performs the purges they report.
   * When set, it wins over the `FORCE_SYNC` env and `Config.database.sync.force`.
   */
  force?: boolean;
}

/**
 * Connects the project's database and reconciles it with the schema the registries declare.
 * The desired schema builds from the collection and field registries; pending migrations run inside.
 * Force resolves from `options.force`, then the `FORCE_SYNC` env, then `Config.database.sync.force`.
 * Force deletions and orphan warnings land in warn blocks; a refusal throws through the funnel.
 * `serveAPI` runs it before `listen()`; `ohne sync` runs it standalone.
 */
export async function syncProjectDatabase(options: SyncProjectOptions = {}): Promise<GuardReport> {
  const dialect = await connect();
  const database = useConfig().database;
  const force =
    options.force ??
    (useEnv().has('FORCE_SYNC') ? useEnv().get('FORCE_SYNC') : (database?.sync?.force ?? false));
  const report = await syncDatabase(useDatabase(), dialect, {
    desired: buildDesiredSchema(useCollections(), useFields()),
    migrations: Object.values(useMigrations().all()),
    force,
  });
  if (report.deletions.length > 0) {
    usePrinter().warnBlock({
      title: 'Sync removed data under `force`',
      body: report.deletions.join('\n'),
    });
  }
  if (report.warnings.length > 0) {
    usePrinter().warnBlock({
      title: 'Pre-existing orphan rows',
      body: [
        ...report.warnings,
        '',
        'Set `FORCE_SYNC` or `database.sync.force` to purge them.',
      ].join('\n'),
    });
  }
  return report;
}
