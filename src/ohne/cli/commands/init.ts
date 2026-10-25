import { exec } from 'node:child_process';
import { homedir } from 'node:os';
import { promisify } from 'node:util';

import type { Prompt } from '../../../utils/cli/index.ts';
import type { TarEntry } from '../../../utils/index.ts';
import type { BlockOptions } from '../../../utils/print/index.ts';

import { codeSpan, isColorStream, pickANSIColors } from '../../../utils/ansi/index.ts';
import { createPrompt, defineCommand, isCancel } from '../../../utils/cli/index.ts';
import { emptyDir, readDir, writeFile, writeJSON } from '../../../utils/fs/index.ts';
import {
  basename,
  expandTilde,
  first,
  isNull,
  isPackageName,
  isPrerelease,
  isUndefined,
  joinPath,
  launcherName,
  relativePath,
  resolvePath,
  shellPath,
  slugify,
} from '../../../utils/index.ts';
import { colorOverride } from '../../env/color-override.ts';
import { toolchain } from '../../meta/toolchain.ts';
import { version } from '../../meta/version.ts';
import { usePrinter } from '../../printer/use-printer.ts';
import { readStarter, webRefusal, writeStarter } from '../starter.ts';

// A shell, because Windows starts the `.cmd` shims of npm and pnpm only through one.
const run = promisify(exec);

const CONTROL = /\p{Cc}/u;

const NAME_RULE = 'Use lowercase letters, digits, and `-`, as in `my-app`.';

const NPM_FLAGS = 'With npm, flags go after `--`: `npm create ohne my-app -- --yes`.';

const CONFIG_FILE = `import { defineConfig } from 'ohnejs';

export default defineConfig({
  layers: ['ohnejs/base'],
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
 * The target directory comes from the one positional, where a leading `~` stands for the home directory.
 * When it is omitted, a TTY prompts for the location and a non-TTY defaults to the current directory.
 * The package name defaults to the directory name, slugified when that is not a valid package name.
 * On a TTY it also prompts for the name, a website, the package manager, and git init.
 * Then it installs the dependencies.
 * `--web` scaffolds a pnpm workspace from the Nuxt or Next starter at this version instead.
 * `--yes` skips the prompts and the install, taking the defaults.
 * A non-empty target needs a double confirm to purge, or `--force` to purge without asking.
 * A second positional, a control character, or an invalid name is refused before anything is written.
 * So is `--web` with `--pm npm` or from a prerelease `ohnejs`.
 */
export const initCommand = defineCommand({
  meta: {
    name: 'init',
    description: 'Scaffold a new project.',
    positionals: '[dir]',
  },
  args: {
    name: { type: 'string', description: 'Package name. Derived from the directory by default.' },
    pm: {
      type: 'enum',
      options: ['npm', 'pnpm'],
      description: 'Package manager. Defaults to pnpm when pnpm runs the command, else npm.',
    },
    git: { type: 'boolean', description: 'Initialize a git repository.' },
    yes: { type: 'boolean', alias: 'y', description: 'Skip prompts and take the defaults.' },
    force: { type: 'boolean', alias: 'f', description: 'Empty a non-empty directory first.' },
    web: {
      type: 'enum',
      options: ['nuxt', 'next'],
      description: 'Add a website: a pnpm workspace with apps/backend and apps/web.',
    },
    ohnePath: { type: 'string', hidden: true },
    starter: { type: 'string', hidden: true },
  },
  async run({ values, positionals }) {
    const print = usePrinter();
    const color = colorOverride();
    const prompt = createPrompt({ color });
    const colors = pickANSIColors(color ?? isColorStream(process.stdout));
    const interactive = !values.yes && Boolean(process.stdin.isTTY);
    const cancel = (): undefined => void prompt.outro(colors.red('Cancelled'));
    const keep = (): undefined => void prompt.outro(colors.dim('No changes made'));
    const refuse = (block: BlockOptions): undefined => {
      print.errorBlock(block);
      process.exitCode = 1;
    };

    if ([...positionals, values.name ?? ''].some((arg) => CONTROL.test(arg))) {
      return refuse({
        title: 'Arguments cannot hold control characters',
        body: 'Pick names without newlines, tabs, or escape codes.',
      });
    }
    if (positionals.length > 1) {
      const quoted = codeSpan(shellPath(positionals.join(' ')));
      const body = [`Pass one directory, and quote a name with spaces: ${quoted}.`];
      // Under npm, a stray word usually means an unknown flag's value leaked or a `--` was doubled.
      if (launcher() === 'npm') body.push('', NPM_FLAGS);
      return refuse({ title: `Unexpected argument ${codeSpan(positionals[1]!)}`, body });
    }
    if (!isUndefined(values.name) && !isPackageName(values.name)) {
      return refuse({ title: `Invalid package name ${codeSpan(values.name)}`, body: NAME_RULE });
    }
    const refusal = isUndefined(values.web) ? undefined : webRefusal(values.pm, version);
    if (refusal) return refuse(refusal);

    if (interactive) {
      process.stdout.write('\n');
      prompt.intro('Creating a new **ohne** project');
    }

    let where = first(positionals);
    if (isUndefined(where) && interactive) {
      const answer = await prompt.path({
        message: 'Where should the project go?',
        only: 'directory',
      });
      if (isCancel(answer)) return cancel();
      where = answer;
    }

    const target = resolvePath(expandTilde(where ?? '.', homedir()));
    const dirName = basename(target);
    const derived = isPackageName(dirName) ? dirName : slugify(dirName);
    if (!interactive && isUndefined(values.name) && !isPackageName(derived)) {
      return refuse({
        title: `Invalid package name ${codeSpan(dirName)}`,
        body: `It comes from the directory, so pass one with \`--name\`.\n${NAME_RULE}`,
      });
    }

    const names = await readDir(target);
    const occupied = !isNull(names) && names.length > 0;
    if (occupied) {
      if (!values.force) {
        if (!interactive) {
          return refuse({
            title: 'Directory not empty',
            body: 'Re-run with `--force` to delete its contents and scaffold into it.',
            path: relativePath(process.cwd(), target),
          });
        }
        const clear = await prompt.confirm({
          message: `The directory ${codeSpan(dirName)} is not empty. Delete its contents?`,
          initialValue: false,
        });
        if (isCancel(clear)) return cancel();
        if (!clear) return keep();
        const purge = await prompt.confirm({
          message: `This permanently deletes everything in ${codeSpan(target)}. Continue?`,
          initialValue: false,
        });
        if (isCancel(purge)) return cancel();
        if (!purge) return keep();
      }
    }

    let name = values.name ?? derived;
    if (interactive && isUndefined(values.name)) {
      const answer = await prompt.text({
        message: 'Project name?',
        defaultValue: derived,
        validate: (value) => (isPackageName(value) ? undefined : NAME_RULE),
      });
      if (isCancel(answer)) return cancel();
      name = answer;
    }

    let web = values.web;
    if (interactive && isUndefined(web) && values.pm !== 'npm' && !isPrerelease(version)) {
      const answer = await prompt.select<'nuxt' | 'next' | undefined>({
        message: 'Add a website?',
        options: [
          { value: undefined, label: 'None' },
          { value: 'nuxt', label: 'Nuxt' },
          { value: 'next', label: 'Next' },
        ],
      });
      if (isCancel(answer)) return cancel();
      web = answer;
    }

    let pm = values.pm ?? (web ? 'pnpm' : packageManager());
    if (interactive && isUndefined(values.pm) && isUndefined(web)) {
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
    if (interactive && isUndefined(values.git)) {
      const answer = await prompt.confirm({ message: 'Initialize a git repository?' });
      if (isCancel(answer)) return cancel();
      git = answer;
    }

    const starter = web && (await download(web, values.starter, interactive ? prompt : undefined));
    if (occupied) await emptyDir(target);
    if (starter) await writeStarter(target, name, starter);
    else await scaffold(target, name, values.ohnePath ?? version);
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
      ...(dest ? [`cd ${shellPath(dest)}`] : []),
      ...(installed ? [] : [`${pm} install`]),
      runScript(pm, 'dev'),
    ];

    const body = steps.map((step) => codeSpan(step)).join('\n');
    print.success(`Created ${codeSpan(name)}`);
    if (interactive) prompt.note(body, 'Next steps', true);
    else print.successBlock({ title: 'Next steps:', body, path: dest });
  },
});

/**
 * The package manager that launched this process, read from `npm_config_user_agent`.
 */
function launcher(): string | undefined {
  return launcherName(process.env.npm_config_user_agent);
}

/**
 * The package manager to default to: `pnpm` when pnpm launched this process, else `npm`.
 */
function packageManager(): 'npm' | 'pnpm' {
  return launcher() === 'pnpm' ? 'pnpm' : 'npm';
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
      test: 'ohne prepare && node --test --import ohnejs/register "tests/**/*.test.ts"',
      typecheck: 'tsc',
    },
    dependencies: { ohnejs: ohne },
    ...toolchain,
  });
  await writeFile(joinPath(target, 'tsconfig.json'), TSCONFIG_FILE);
  await writeFile(joinPath(target, '.gitignore'), GITIGNORE_FILE);
}

/**
 * Reads the `web` starter, from `tarball` when given, behind a spinner when a `prompt` runs.
 */
async function download(
  web: 'nuxt' | 'next',
  tarball: string | undefined,
  prompt: Prompt | undefined,
): Promise<TarEntry[]> {
  const spin = prompt?.spinner();
  spin?.start(`Downloading the ${web} starter`);
  try {
    const entries = await readStarter(web, tarball);
    spin?.stop('Starter downloaded');
    return entries;
  } catch (error) {
    spin?.stop(`Could not download the ${web} starter`, 1);
    throw error;
  }
}

/**
 * Runs `<pm> install` in `target`, resolving `false` instead of throwing when it fails.
 */
async function install(pm: 'npm' | 'pnpm', target: string): Promise<boolean> {
  try {
    await run(`${pm} install`, { cwd: target });
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
    await run('git init', { cwd: target });
    return true;
  } catch {
    return false;
  }
}
