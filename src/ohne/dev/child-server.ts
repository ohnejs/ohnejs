import { spawn } from 'node:child_process';

import { formatDuration, isUndefined } from '../../utils/index.ts';
import { ohneError } from '../error/ohne-error.ts';
import { reportError } from '../error/report-error.ts';

/**
 * Which backend a serve child runs, as the `ohne serve <backend>` subcommand.
 */
export type ServeBackend = 'api' | 'dashboard';

/**
 * A spawned `ohne serve <backend>` child the dev supervisor controls.
 *
 * The child is the real production server with an IPC channel; the `api` backend also gets `SKIP_CODEGEN`.
 * The supervisor awaits `ready`, then `stop`s it to reload or shut it down.
 */
export interface ServeChild {
  /**
   * Resolves when the child signals `'ready'` after it is listening.
   * Rejects if the child exits before ever signalling ready, a boot failure the child reports itself.
   * Also rejects once `readyTimeout` passes: the child is killed and this process reports the failure.
   */
  ready: Promise<void>;

  /**
   * Stops the child and resolves once it has exited.
   * A child that signalled ready drains on its own `'shutdown'` funnel, exactly as in production.
   * One that never readied is killed, since it has no funnel to receive the message.
   * Idempotent: later calls await the same exit.
   */
  stop(): Promise<void>;

  /**
   * Sends the child a `'reload'` message, telling the dashboard to reload its connected browsers.
   * A no-op once the IPC channel has closed.
   */
  reload(): void;
}

/**
 * How a child exited.
 */
export interface ChildExit {
  /**
   * Exit code, or `null` when a signal terminated the child.
   */
  code: number | null;

  /**
   * Terminating signal, or `null` when the child exited on its own.
   */
  signal: NodeJS.Signals | null;
}

/**
 * Options for `spawnServeChild`.
 */
export interface SpawnServeChildOptions {
  /**
   * Port the child binds, set as `PORT` so every respawn reuses the same one.
   * Omitted lets the child resolve its own port from config or `PORT`.
   */
  port?: number;

  /**
   * Called when a child that had signalled ready exits on its own - a runtime crash.
   * Not called for a `stop`, nor for a boot failure, which rejects `ready` instead.
   */
  onExit?: (exit: ChildExit) => void;

  /**
   * Milliseconds to wait for a drain before sending `SIGKILL`.
   *
   * @default
   * 10000
   */
  killTimeout?: number;

  /**
   * Milliseconds to wait for the `'ready'` signal before the boot counts as failed.
   * On expiry the child is killed and `ready` rejects, so a hung boot never stalls the supervisor.
   *
   * @default
   * 60000
   */
  readyTimeout?: number;

  /**
   * CLI entry to run, as `node <entry> serve <backend>`.
   *
   * @default
   * process.argv[1]
   */
  entry?: string;

  /**
   * Extra environment variables for the child, merged over the inherited `process.env`.
   */
  env?: Record<string, string>;
}

const KILL_TIMEOUT = 10_000;
const READY_TIMEOUT = 60_000;

/**
 * Spawns `ohne serve <backend>` as a supervised child and returns handles to its lifecycle.
 *
 * The child runs the real CLI entry with an IPC channel; the `api` backend also gets `SKIP_CODEGEN=1`.
 * The supervisor owns codegen; the child only serves.
 * `ready` settles the boot outcome; `stop` drains or kills it.
 * A child that neither readies nor exits within `readyTimeout` is killed and counts as a boot failure.
 * `process.execArgv` is forwarded so node flags carry over, minus `--inspect*` to avoid a port clash.
 */
export function spawnServeChild(
  cwd: string,
  backend: ServeBackend,
  options: SpawnServeChildOptions = {},
): ServeChild {
  const {
    port,
    onExit,
    killTimeout = KILL_TIMEOUT,
    readyTimeout = READY_TIMEOUT,
    entry = process.argv[1],
  } = options;

  const env = {
    ...process.env,
    ...(backend === 'api' ? { SKIP_CODEGEN: '1' } : {}),
    ...(isUndefined(port) ? {} : { PORT: String(port) }),
    ...options.env,
  };
  const args = [...nodeFlags(), entry, 'serve', backend, '--cwd', cwd];
  const child = spawn(process.execPath, args, {
    env,
    stdio: ['inherit', 'inherit', 'inherit', 'ipc'],
  });

  let readied = false;
  let commanded = false;
  let gone = false;
  let stopping: Promise<void> | undefined;
  let markReady: () => void;
  let failBoot: (error: Error) => void;
  let markGone: () => void;
  const ready = new Promise<void>((resolve, reject) => {
    markReady = resolve;
    failBoot = reject;
  });
  const exited = new Promise<void>((resolve) => {
    markGone = resolve;
  });

  const bootTimer = setTimeout(() => {
    const error = ohneError(
      `\`${backend}\` child did not signal ready within \`${formatDuration(readyTimeout)}\``,
    );
    reportError(error);
    failBoot(error);
    void stop();
  }, readyTimeout);

  child.on('message', (message) => {
    if (message === 'ready') {
      readied = true;
      clearTimeout(bootTimer);
      markReady();
    }
  });

  child.on('error', (error) => {
    if (!readied && !commanded) failBoot(error);
  });

  child.once('exit', (code, signal) => {
    gone = true;
    clearTimeout(bootTimer);
    markGone();
    if (commanded) return;
    if (readied) onExit?.({ code, signal });
    else
      failBoot(
        ohneError(
          `\`${backend}\` child exited before ready (code \`${code}\`, signal \`${signal}\`)`,
        ),
      );
  });

  return {
    ready,
    stop,
    reload: () => send('reload'),
  };

  function stop(): Promise<void> {
    return (stopping ??= drain());
  }

  async function drain(): Promise<void> {
    commanded = true;
    if (gone) return;
    if (readied) send('shutdown');
    else child.kill();
    const timer = setTimeout(() => child.kill('SIGKILL'), killTimeout);
    try {
      await exited;
    } finally {
      clearTimeout(timer);
    }
  }

  function send(message: string): void {
    if (!child.connected) return;
    try {
      child.send(message);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ERR_IPC_CHANNEL_CLOSED') throw error;
    }
  }
}

function nodeFlags(): string[] {
  return process.execArgv.filter((flag) => !flag.startsWith('--inspect'));
}
