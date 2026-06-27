import { defineCommand } from '../../../utils/cli/index.ts';
import {
  formatDuration,
  isString,
  measure,
  naturalCompare,
  relativePath,
  resolvePath,
} from '../../../utils/index.ts';
import { generateLayerName } from '../../codegen/generate-layer-name.ts';
import { generateMiddleware } from '../../codegen/generate-middleware.ts';
import { generateResolvedConfig } from '../../codegen/generate-resolved-config.ts';
import { generateRoutes } from '../../codegen/generate-routes.ts';
import { loadLayers } from '../../layers/load-layers.ts';
import { usePrinter } from '../../printer/use-printer.ts';
import { isOhneProject } from '../../project/is-ohne-project.ts';

/**
 * The `ohne prepare` command.
 * Runs every codegen for the project at `--cwd`, writing the generated types into its codegen dir.
 *
 * Refuses to run outside an ohne project and sets a non-zero exit code in that case.
 */
export const prepareCommand = defineCommand({
  meta: {
    name: 'prepare',
    description: 'Generate the project types.',
  },
  args: {
    cwd: { type: 'string', description: 'Project root to prepare.' },
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

    const { result: written, ms } = await measure(async () => {
      await loadLayers(cwd);
      return (
        await Promise.all([
          generateLayerName(cwd),
          generateResolvedConfig(cwd),
          generateRoutes(cwd),
          generateMiddleware(cwd),
        ])
      ).filter(isString);
    });

    print.successBlock({
      title: `Project prepared __in ${formatDuration(ms)}__`,
      body: written
        .map((file) => relativePath(cwd, file))
        .sort(naturalCompare)
        .map((path) => `__${path}__`)
        .join('\n'),
      path: relativePath(process.cwd(), cwd),
    });
  },
});
