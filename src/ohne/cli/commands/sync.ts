import { pathToFileURL } from 'node:url';

import { defineCommand } from '../../../utils/cli/index.ts';
import { exists } from '../../../utils/fs/index.ts';
import {
  formatDuration,
  isNull,
  joinPath,
  measure,
  relativePath,
  resolvePath,
} from '../../../utils/index.ts';
import { bootLayers } from '../../boot/boot-layers.ts';
import { codegenDir } from '../../codegen/codegen-dir.ts';
import { generateDatabase } from '../../codegen/generate-database.ts';
import { syncProjectDatabase } from '../../database/sync-project.ts';
import { closeDatabases } from '../../database/use-database.ts';
import { useEnv } from '../../env/use-env.ts';
import { loadLayers } from '../../layers/load-layers.ts';
import { useShutdown } from '../../lifecycle/use-shutdown.ts';
import { usePrinter } from '../../printer/use-printer.ts';
import { isOhneProject } from '../../project/is-ohne-project.ts';
import { loadProjectEnv } from '../../project/load-project-env.ts';

/**
 * The `ohne sync` command.
 * Reconciles the project's database with the schema its code declares, then exits.
 * The project `.env` is read first, so `DATABASE` and `FORCE_SYNC` may live there.
 * Boot files run first, so layer dialects register; codegen refreshes the database registrations.
 * Codegen is skipped when the `SKIP_CODEGEN` env is truthy.
 * `--force` authorizes and performs destructive changes, exactly like the `FORCE_SYNC` env.
 * `--dry-run` rehearses the sync against the live database and rolls it back, writing nothing.
 * It exits non-zero where a real sync would be refused, so a deploy can gate on it before cutover.
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
        await bootLayers();
        if (!useEnv().get('SKIP_CODEGEN')) await generateDatabase(cwd);
        const dir = await codegenDir(cwd);
        if (!isNull(dir)) {
          const file = joinPath(dir, 'node', 'database.ts');
          if (await exists(file)) await import(pathToFileURL(file).href);
        }
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
