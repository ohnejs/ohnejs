import { defineCommand } from '../../../utils/cli/index.ts';
import { relativePath, resolvePath } from '../../../utils/index.ts';
import { dev } from '../../dev/supervisor.ts';
import { usePrinter } from '../../printer/use-printer.ts';
import { isOhneProject } from '../../project/is-ohne-project.ts';

/**
 * The `ohne dev` command.
 * Watches the project at `--cwd` and reloads the API server on every change.
 *
 * Refuses to run outside an ohne project and sets a non-zero exit code in that case.
 */
export const devCommand = defineCommand({
  meta: {
    name: 'dev',
    description: 'Watch the project and reload the API server on change.',
  },
  args: {
    cwd: { type: 'string', description: 'Project root to watch.' },
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

    await dev(cwd);
  },
});
