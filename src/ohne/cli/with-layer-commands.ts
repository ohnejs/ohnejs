import type { ArgSchema, Command } from '../../utils/cli/index.ts';

import { parseArgv } from '../../utils/cli/index.ts';
import {
  didYouMean,
  first,
  hasKey,
  isString,
  isUndefined,
  last,
  mapValues,
  relativePath,
  resolvePath,
  toArray,
  toKebabCase,
} from '../../utils/index.ts';
import { bootProject } from '../boot/boot-project.ts';
import { collectCommands } from '../commands/collect-commands.ts';
import { importCommand } from '../commands/import-command.ts';
import { connect } from '../database/connect.ts';
import { isProjectSynced } from '../database/sync-project.ts';
import { closeDatabases } from '../database/use-database.ts';
import { envGlobals } from '../env/env-flags.ts';
import { ohneError } from '../error/ohne-error.ts';
import { loadLayers } from '../layers/load-layers.ts';
import { stackedLayers } from '../layers/stacked-layers.ts';
import { useShutdown } from '../lifecycle/use-shutdown.ts';
import { usePrinter } from '../printer/use-printer.ts';
import { isOhneProject } from '../project/is-ohne-project.ts';
import { loadProjectEnv } from '../project/load-project-env.ts';
import { closeRateLimitStore } from '../rate-limit/_resolve-rate-limit-store.ts';

const CWD: ArgSchema = { type: 'string', description: 'Project root to run in.' };

/**
 * Returns `root` with the commands of the project's layers mounted beside its built-in subcommands.
 *
 * The stack loads only for a command the built-ins lack, or for the root help.
 * The project is the `--cwd` in `argv`, else the working directory, and its `.env` and stack load here once.
 * Outside a project, a name that is no built-in throws `Not an ohne project`, unless it is a typo of one.
 * Only the named command's file is imported; the root help and an unknown name import them all.
 * A layer command named like a built-in never runs; the root help and an unknown name warn about it.
 *
 * Each runnable command gains `--cwd` and runs inside the booted project, database connected.
 * A command declaring `--cwd` or an env flag throws.
 * The shutdown hooks run after `run`, even when it throws, and the database closes after them.
 *
 * @example
 * ```ts
 * await runCommand(await withLayerCommands(ohne, argv), argv)
 * ```
 */
export async function withLayerCommands(root: Command, argv: string[]): Promise<Command> {
  const builtins = root.subCommands ?? {};
  const head = first(argv);
  const token = isUndefined(head) || head.startsWith('-') ? undefined : head;
  if (!isUndefined(token) && hasKey(builtins, token)) return root;

  const { flags, positionals } = parseArgv(argv, { booleans: ['help', 'h', 'version', 'v'] });
  const help = flags.help || flags.h;
  const misplaced = positionals.length > 0;
  if (isUndefined(token) && !help && (flags.version || flags.v || misplaced)) return root;

  const cwd = last(toArray(flags.cwd ?? []));
  const project = resolvePath(isString(cwd) ? cwd : '.');
  if (!(await isOhneProject(project))) {
    if (isUndefined(token) || !isUndefined(didYouMean(token, Object.keys(builtins)))) return root;
    throw ohneError({
      title: 'Not an ohne project',
      body: ['No `ohne.config.ts` at the project root.'],
      path: project,
    });
  }

  await loadProjectEnv(project);
  await loadLayers(project);
  const commands = await collectCommands(stackedLayers());
  const named = commands.find((command) => command.name === token);
  const reserved = new Set(['cwd', ...Object.keys(envGlobals()).map(toKebabCase)]);
  const mounted: Record<string, Command> = {};
  for (const command of named ? [named] : commands) {
    if (hasKey(builtins, command.name)) {
      usePrinter().warnBlock({
        title: `Command \`${command.name}\` is built in`,
        body: 'The built-in always runs, so this one never does.',
        path: relativePath(process.cwd(), command.file),
      });
      continue;
    }
    const definition = await importCommand(command);
    mounted[command.name] = mount(definition, command.file, project, reserved);
  }
  return { ...root, subCommands: { ...builtins, ...mounted } };
}

/**
 * Copies `command`, giving each runnable node `--cwd` and running it inside `project`.
 * The imported definition stays untouched, since the module cache hands the same object to every mount.
 * A node whose flag or alias is `reserved` throws, naming the command's `file`.
 */
function mount(command: Command, file: string, project: string, reserved: Set<string>): Command {
  const { args = {}, subCommands, run } = command;
  const taken = Object.entries(args)
    .flatMap(([name, def]) => [name, ...toArray(def.alias ?? [])])
    .map(toKebabCase)
    .find((flag) => reserved.has(flag));
  if (!isUndefined(taken)) {
    throw ohneError({
      title: `Command \`${command.meta.name}\` declares \`--${taken}\``,
      body: [
        `ohne reads \`--${taken}\` on every command, so a command cannot take it.`,
        'Rename the flag.',
      ],
      path: file,
    });
  }
  const mounted: Command = { ...command };
  if (subCommands) {
    mounted.subCommands = mapValues(subCommands, (_, sub) => mount(sub, file, project, reserved));
  }
  if (run) {
    mounted.args = { ...args, cwd: CWD };
    mounted.run = (context) => runInProject(project, () => run.call(command, context));
  }
  return mounted;
}

/**
 * Boots `project`, connects its database, warns when it is not synced, and runs `work`.
 */
async function runInProject(project: string, work: () => void | Promise<void>): Promise<void> {
  try {
    await bootProject(project);
    await connect();
    if (!(await isProjectSynced())) {
      usePrinter().warnBlock({
        title: 'Database not synced',
        body: [
          'Its tables do not match the collections, so a query may fail.',
          '',
          'Run `ohne sync`.',
        ],
      });
    }
    await work();
  } finally {
    await useShutdown().run();
    await closeRateLimitStore();
    await closeDatabases();
  }
}
