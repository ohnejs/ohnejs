import type { GuardReport } from './schema/guard.ts';

import { useBlocks } from '../blocks/use-blocks.ts';
import { resolveLocales } from '../collections/resolve-locales.ts';
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

  /**
   * Rehearses the sync against the live database, then rolls it back so nothing is committed.
   * The reconciliation runs in full - a refusal still throws - and the report reads in the future tense.
   * `ohne sync --dry-run` sets it; `serveAPI` never does.
   *
   * @default
   * false
   */
  dryRun?: boolean;
}

/**
 * Connects the project's database and reconciles it with the schema the registries declare.
 * The desired schema builds from the collection, field, and block registries; migrations run inside.
 * Force resolves from `options.force`, then the `FORCE_SYNC` env, then `Config.database.sync.force`.
 * The default content locale resolves from `Config.collections`, feeding the translatable fan-out.
 * Deletions - forced, or authorized by an applied migration - land in a warn block.
 * Orphan warnings land in another; a refusal throws through the funnel.
 * Under `dryRun` the reconciliation rolls back and the two blocks read in the future tense.
 * `serveAPI` runs it before `listen()`; `ohne sync` runs it standalone.
 */
export async function syncProjectDatabase(options: SyncProjectOptions = {}): Promise<GuardReport> {
  const dialect = await connect();
  const database = useConfig().database;
  const force =
    options.force ??
    (useEnv().has('FORCE_SYNC') ? useEnv().get('FORCE_SYNC') : (database?.sync?.force ?? false));
  const dryRun = options.dryRun ?? false;
  const report = await syncDatabase(useDatabase(), dialect, {
    desired: buildDesiredSchema(useCollections(), useFields(), useBlocks()),
    migrations: Object.values(useMigrations().all()),
    force,
    dryRun,
    defaultLocale: resolveLocales(useConfig().collections).defaultLocale,
  });
  if (report.deletions.length > 0) {
    usePrinter().warnBlock({
      title: dryRun
        ? 'Sync would remove data'
        : force
          ? 'Sync removed data under `force`'
          : 'Migrations removed data',
      body: report.deletions.join('\n'),
    });
  }
  if (report.warnings.length > 0) {
    usePrinter().warnBlock({
      title: dryRun ? 'Orphan rows would remain' : 'Pre-existing orphan rows',
      body: [
        ...report.warnings,
        '',
        'Set `FORCE_SYNC` or `database.sync.force` to purge them.',
      ].join('\n'),
    });
  }
  return report;
}
