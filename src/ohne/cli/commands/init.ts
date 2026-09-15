import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import { isColorStream, pickANSIColors } from '../../../utils/ansi/index.ts';
import { createPrompt, defineCommand, isCancel } from '../../../utils/cli/index.ts';
import { listDir, removeDir, writeFile, writeJSON } from '../../../utils/fs/index.ts';
import {
  basename,
  isNull,
  isUndefined,
  joinPath,
  relativePath,
  resolvePath,
} from '../../../utils/index.ts';
import { colorOverride } from '../../env/color-override.ts';
import { version } from '../../meta/version.ts';
import { usePrinter } from '../../printer/use-printer.ts';

const run = promisify(execFile);

const CONFIG_FILE = `import { defineConfig } from 'ohnejs';

export default defineConfig({
  layers: ['ohnejs'],
});
`;

const TSCONFIG_FILE = `{
  "extends": "ohnejs/tsconfig.node.json",
  "include": ["**/*.ts", ".ohne/shared/**/*.ts", ".ohne/node/**/*.ts"],
  "exclude": ["dashboard"]
}
`;

const GITIGNORE_FILE = `# Dependencies
node_modules/

# Generated
.ohne/

# Data
.data/

# Environment / secrets
.env

# OS
.DS_Store
`;

/**
 * The `ohne init` command.
 * Scaffolds a new ohne project.
 * Writes `ohne.config.ts`, `package.json`, `tsconfig.json`, and `.gitignore`.
 *
 * `tsconfig.json` type-checks the Node code and excludes `dashboard/`.
 * No dashboard is scaffolded; `serve dashboard` suggests a `dashboard/tsconfig.json` when one appears.
 *
 * The target directory comes from the first positional.
 * When it is omitted, a TTY prompts for the location and a non-TTY defaults to the current directory.
 * On a TTY it also prompts for the name, package manager, and git init, then installs the dependencies.
 * `--yes` skips the prompts and the install, taking the defaults.
 * A non-empty target needs a double confirm to purge, or `--force` to purge without asking.
 */
export const initCommand = defineCommand({
  meta: {
    name: 'init',
    description: 'Scaffold a new project.',
  },
  args: {
    name: { type: 'string', description: 'Package name. Defaults to the directory name.' },
    git: { type: 'boolean', description: 'Initialize a git repository.' },
    yes: { type: 'boolean', alias: 'y', description: 'Skip prompts and take the defaults.' },
    force: { type: 'boolean', alias: 'f', description: 'Overwrite a non-empty directory.' },
    ohnePath: { type: 'string', hidden: true },
  },
  async run({ values, positionals }) {
    const print = usePrinter();
    const color = colorOverride();
    const prompt = createPrompt({ color });
    const colors = pickANSIColors(color ?? isColorStream(process.stdout));
    const interactive = !values.yes && Boolean(process.stdin.isTTY);
    const cancel = (): undefined => void prompt.outro(colors.red('Cancelled'));
    const keep = (): undefined => void prompt.outro(colors.dim('No changes made'));
    if (interactive) {
      process.stdout.write('\n');
      prompt.intro('Creating a new **ohne** project');
    }

    let where = positionals[0];
    if (isUndefined(where) && interactive) {
      const answer = await prompt.path({
        message: 'Where should the project go?',
        only: 'directory',
      });
      if (isCancel(answer)) return cancel();
      where = answer;
    }

    const target = resolvePath(where ?? '.');
    const dirName = basename(target);

    const entries = await listDir(target, { depth: 0, dirs: true, hidden: true });
    if (!isNull(entries) && entries.length > 0) {
      if (!values.force) {
        if (!interactive) {
          print.errorBlock({
            title: 'Directory not empty',
            body: 'Re-run with `--force` to overwrite its contents.',
            path: relativePath(process.cwd(), target),
          });
          process.exitCode = 1;
          return;
        }
        const clear = await prompt.confirm({
          message: `The directory \`${dirName}\` is not empty. Delete its contents?`,
          initialValue: false,
        });
        if (isCancel(clear)) return cancel();
        if (!clear) return keep();
        const purge = await prompt.confirm({
          message: `This permanently deletes everything in \`${target}\`. Continue?`,
          initialValue: false,
        });
        if (isCancel(purge)) return cancel();
        if (!purge) return keep();
      }
      await removeDir(target);
    }

    let name = values.name ?? dirName;
    if (interactive && isUndefined(values.name)) {
      const answer = await prompt.text({ message: 'Project name?', defaultValue: dirName });
      if (isCancel(answer)) return cancel();
      name = answer;
    }

    let pm = packageManager();
    if (interactive) {
      const answer = await prompt.select<'npm' | 'pnpm'>({
        message: 'Package manager?',
        options: [
          { value: 'npm', label: 'npm' },
          { value: 'pnpm', label: 'pnpm' },
        ],
        initialValue: pm,
      });
      if (isCancel(answer)) return cancel();
      pm = answer;
    }

    let git = values.git;
    if (interactive && !values.git) {
      const answer = await prompt.confirm({ message: 'Initialize a git repository?' });
      if (isCancel(answer)) return cancel();
      git = answer;
    }

    await scaffold(target, name, values.ohnePath ?? version);
    if (git) await gitInit(target);

    let installed = false;
    if (interactive) {
      const spin = prompt.spinner();
      spin.start(`Installing dependencies with ${pm}`);
      installed = await install(pm, target);
      spin.stop(
        installed ? 'Dependencies installed' : `Could not install with ${pm}`,
        installed ? 0 : 1,
      );
    }

    if (interactive) {
      process.stdout.write(`${colors.dim('│')}\n`);
    }

    const dest = relativePath(process.cwd(), target);
    const steps = [
      ...(dest ? [`cd ${dest}`] : []),
      ...(installed ? [] : [`${pm} install`]),
      runScript(pm, 'dev'),
    ];

    const body = steps.map((step) => `\`${step}\``).join('\n');
    print.success(`Created \`${name}\``);
    if (interactive) prompt.note(body, 'Next steps', true);
    else
      print.successBlock({ title: 'Next steps:', body, path: relativePath(process.cwd(), target) });
  },
});

/**
 * The package manager to default to: `npm` when npm launched this process, else `pnpm`.
 */
function packageManager(): 'npm' | 'pnpm' {
  return (process.env.npm_config_user_agent ?? '').startsWith('npm/') ? 'npm' : 'pnpm';
}

/**
 * The command that runs `script` under `pm`: `npm run <script>` for npm, `<pm> <script>` otherwise.
 */
function runScript(pm: string, script: string): string {
  return pm === 'npm' ? `npm run ${script}` : `${pm} ${script}`;
}

/**
 * Writes the starter project files into `target`, with `ohnejs` as the dependency's version or local path.
 */
async function scaffold(target: string, name: string, ohne: string): Promise<void> {
  await writeFile(joinPath(target, 'ohne.config.ts'), CONFIG_FILE);
  await writeJSON(joinPath(target, 'package.json'), {
    name,
    type: 'module',
    private: true,
    scripts: {
      dev: 'ohne dev',
      'serve:api': 'ohne serve api',
      'serve:dashboard': 'ohne serve dashboard',
      prepare: 'ohne prepare',
      typecheck: 'tsc',
    },
    dependencies: { ohnejs: ohne },
    devDependencies: { '@types/node': '26.0.0', typescript: '7.0.2' },
    engines: { node: '>=26.0.0' },
  });
  await writeFile(joinPath(target, 'tsconfig.json'), TSCONFIG_FILE);
  await writeFile(joinPath(target, '.gitignore'), GITIGNORE_FILE);
}

/**
 * Runs `<pm> install` in `target`, resolving `false` instead of throwing when it fails.
 */
async function install(pm: string, target: string): Promise<boolean> {
  try {
    await run(pm, ['install'], { cwd: target });
    return true;
  } catch {
    return false;
  }
}

/**
 * Runs `git init` in `target`, resolving `false` instead of throwing when it fails.
 */
async function gitInit(target: string): Promise<boolean> {
  try {
    await run('git', ['init'], { cwd: target });
    return true;
  } catch {
    return false;
  }
}
