import { defineCommand } from '../../../utils/cli/index.ts';
import { relativePath, resolvePath } from '../../../utils/index.ts';
import { usePrinter } from '../../printer/use-printer.ts';
import { isOhneProject } from '../../project/is-ohne-project.ts';
import { serveAPI } from '../../serve/api.ts';
import { serveDashboard } from '../../serve/dashboard.ts';

const apiCommand = defineCommand({
  meta: {
    name: 'api',
    description: 'Serve the API backend.',
  },
  args: {
    cwd: { type: 'string', description: 'Project root to serve.' },
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

    await serveAPI(cwd);
  },
});

const dashboardCommand = defineCommand({
  meta: {
    name: 'dashboard',
    description: 'Serve the dashboard.',
  },
  args: {
    cwd: { type: 'string', description: 'Project root to serve.' },
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

    await serveDashboard(cwd);
  },
});

/**
 * The `ohne serve` command.
 * Dispatches to a backend by the first positional: `api` or `dashboard`.
 */
export const serveCommand = defineCommand({
  meta: {
    name: 'serve',
    description: 'Serve an ohne app.',
  },
  subCommands: {
    api: apiCommand,
    dashboard: dashboardCommand,
  },
});
