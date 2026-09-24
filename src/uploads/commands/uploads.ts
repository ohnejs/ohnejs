import { usePrinter } from 'ohnejs';
import { formatDuration, isNull, measure, pluralize } from 'ohnejs/utils';
import { defineCommand } from 'ohnejs/utils/cli';

import { useStorage } from '../storage/use-storages.ts';
import { pruneUploads } from '../uploads/prune-uploads.ts';

const prune = defineCommand({
  meta: {
    name: 'prune',
    description: 'List the stored files no upload names.',
  },
  args: {
    delete: { type: 'boolean', description: 'Delete the files it lists.' },
  },
  async run({ values }) {
    const print = usePrinter();
    const { result: paths, ms } = await measure(() => pruneUploads({ delete: values.delete }));
    const took = `__in ${formatDuration(ms)}__`;
    if (paths.length === 0) {
      print.success(`No stray files ${took}`);
      return;
    }
    if (!values.delete) {
      print.warnBlock({
        title: `Found ${strays(paths)} ${took}`,
        body: `${rows(paths)}\n\nRun it again with \`--delete\` to delete them.`,
      });
      return;
    }

    const stats = await Promise.all(paths.map((path) => useStorage().stat(path)));
    const deleted = paths.filter((_, i) => isNull(stats[i]));
    const kept = paths.filter((_, i) => !isNull(stats[i]));
    if (deleted.length > 0) {
      print.successBlock({ title: `Deleted ${strays(deleted)} ${took}`, body: rows(deleted) });
    }
    if (kept.length > 0) {
      print.errorBlock({
        title: `Could not delete ${strays(kept)}`,
        body: `${rows(kept)}\n\nohne retries them on the next prune or the next API start.`,
      });
      process.exitCode = 1;
    }
  },
});

/**
 * The `ohne uploads` command, which groups upkeep of the uploads storage.
 */
export default defineCommand({
  meta: {
    name: 'uploads',
    description: 'Maintain the uploads storage.',
  },
  subCommands: { prune },
});

/**
 * Counts `paths` as stray files, agreeing in number.
 */
function strays(paths: readonly string[]): string {
  return `${paths.length} stray ${pluralize(paths.length, 'file')}`;
}

/**
 * Lists `paths` one per body row.
 */
function rows(paths: readonly string[]): string {
  return paths.map((path) => `- \`${path}\``).join('\n');
}
