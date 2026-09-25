import { defineCommand } from '../../../utils/cli/index.ts';
import { formatDuration, measure, relativePath, resolvePath } from '../../../utils/index.ts';
import { bootProject } from '../../boot/boot-project.ts';
import { syncProjectDatabase } from '../../database/sync-project.ts';
import { closeDatabases } from '../../database/use-database.ts';
import { loadLayers } from '../../layers/load-layers.ts';
import { useShutdown } from '../../lifecycle/use-shutdown.ts';
import { usePrinter } from '../../printer/use-printer.ts';
import { isOhneProject } from '../../project/is-ohne-project.ts';
import { loadProjectEnv } from '../../project/load-project-env.ts';

/**
 * The `ohne sync` command.
 * Reconciles the project's database with the schema its code declares, then exits.
 * The project boots as `ohne serve api` boots it, short of the port, so both run the same sync.
 * The project `.env` is read first, so `DATABASE` and `FORCE_SYNC` may live there.
 * `--force` authorizes and performs destructive changes, exactly like the `FORCE_SYNC` env.
 * `--dry-run` rehearses the sync against the live database and rolls it back, writing nothing.
 * It exits non-zero where a real sync would be refused, so a deploy can gate on it before cutover.
 * The shutdown hooks run after the sync, even when it throws, and the database closes after them.
 *
 * Refuses to run outside an ohne project and sets a non-zero exit code in that case.
 */
export const syncCommand = defineCommand({
  meta: {
    name: 'sync',
    description: 'Sync the database schema.',
  },
  args: {
    cwd: { type: 'string', description: 'Project root to sync.' },
    force: { type: 'boolean', description: 'Authorize and perform destructive changes.' },
    dryRun: { type: 'boolean', description: 'Rehearse the sync and roll it back without writing.' },
  },
  async run({ values }) {
    const cwd = resolvePath(values.cwd ?? '.');
    const print = usePrinter();

    if (!(await isOhneProject(cwd))) {
      print.errorBlock({
        title: 'Not an ohne project',
        body: 'No `ohne.config.ts` at the project root.',
        path: relativePath(process.cwd(), cwd),
      });
      process.exitCode = 1;
      return;
    }

    await loadProjectEnv(cwd);
    const { ms } = await measure(async () => {
      await loadLayers(cwd);
      try {
        await bootProject(cwd);
        await syncProjectDatabase({
          ...(values.force ? { force: true } : {}),
          ...(values.dryRun ? { dryRun: true } : {}),
        });
      } finally {
        await useShutdown().run();
        await closeDatabases();
      }
    });

    print.success(
      values.dryRun
        ? `Dry run passed, the database is unchanged __in ${formatDuration(ms)}__`
        : `Database synced __in ${formatDuration(ms)}__`,
    );
  },
});
