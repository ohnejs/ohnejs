import { createServer } from 'node:net';

import { debounce, extname, isNull } from '../../utils/index.ts';
import { useEnv } from '../env/use-env.ts';
import { reportError } from '../error/report-error.ts';
import { DEFAULT_PORT } from '../layers/config.ts';
import { loadLayers } from '../layers/load-layers.ts';
import { useConfig } from '../layers/use-config.ts';
import { onShutdown } from '../lifecycle/on-shutdown.ts';
import { useShutdown } from '../lifecycle/use-shutdown.ts';
import { usePrinter } from '../printer/use-printer.ts';
import { type APIChild, spawnAPIChild } from './child-server.ts';
import { createConfigTarget } from './targets/config.ts';
import { createMiddlewareTarget } from './targets/middleware.ts';
import { createRoutesTarget } from './targets/routes.ts';
import { watchLayers } from './watch-layers.ts';

const DEBOUNCE = 100;
const SOURCE = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.mts', '.cts']);

/**
 * A running dev supervisor.
 */
export interface DevServer {
  /**
   * Stops watching and drains the current child, resolving once it has exited.
   * Idempotent.
   */
  close(): Promise<void>;
}

/**
 * Options for `dev`.
 */
export interface DevOptions {
  /**
   * CLI entry to spawn the server child with, as `node <entry> serve api`.
   *
   * @default
   * process.argv[1]
   */
  entry?: string;
}

/**
 * Watches the project and reloads `ohne serve api` on every change.
 *
 * Owns codegen, then spawns the server as a child with `SKIP_CODEGEN` so the child only serves.
 * A change re-runs the affected codegen, then drains the child and respawns it.
 * An `ohne.config.ts` change refreshes the registry first, as a barrier, so every table is rebuilt.
 *
 * Codegen failures and child crashes never tear the supervisor down.
 * It prints, waits for the next change, then revives once a respawn reaches `'ready'`.
 *
 * The app root is the nearest `package.json` above `from` (default `process.cwd()`).
 */
export async function dev(
  from: string = process.cwd(),
  options: DevOptions = {},
): Promise<DevServer> {
  const printer = usePrinter();
  await loadLayers(from);

  const routes = createRoutesTarget(from);
  const middleware = createMiddlewareTarget(from);
  const config = createConfigTarget(from, [routes, middleware]);
  const targets = [routes, middleware];
  const port = await resolvePort();

  let child: APIChild | null = null;
  const pending = new Set<string>();
  let cycling = false;
  let rerun = false;

  let codegenOK = false;
  try {
    await regen(null);
    codegenOK = true;
  } catch (error) {
    reportError(error);
  }
  if (codegenOK) {
    try {
      await respawn();
    } catch {
      park();
    }
  }

  // Watch only after the initial build, so no change can race the first spawn.
  const schedule = debounce(() => void tick(), DEBOUNCE);
  const watch = watchLayers((path) => {
    pending.add(path);
    schedule();
  });

  let closing: Promise<void> | undefined;
  onShutdown(close);
  useShutdown().watch();
  return { close };

  async function tick(): Promise<void> {
    if (cycling) {
      rerun = true;
      return;
    }
    cycling = true;
    try {
      do {
        rerun = false;
        const batch = new Set(pending);
        pending.clear();
        if (batch.size === 0) break;
        await runCycle(batch);
      } while (rerun || pending.size > 0);
    } finally {
      cycling = false;
    }
  }

  async function runCycle(batch: Set<string>): Promise<void> {
    try {
      await regen(batch);
    } catch (error) {
      reportError(error);
      return;
    }
    if (![...batch].some(isSource)) return;
    printer.info('reloading');
    try {
      await respawn();
    } catch {
      park();
    }
  }

  async function regen(batch: Set<string> | null): Promise<void> {
    if (isNull(batch)) {
      await Promise.all(targets.map((target) => target.regen()));
      return;
    }
    const paths = [...batch];
    if (paths.some((path) => config.affectedBy(path))) {
      await config.regen();
      watch.resync();
      return;
    }
    for (const target of targets) {
      if (paths.some((path) => target.affectedBy(path))) await target.regen();
    }
  }

  async function respawn(): Promise<void> {
    if (child) {
      const previous = child;
      child = null;
      await previous.stop();
    }
    const next = spawnAPIChild(from, { port, entry: options.entry, onExit: onCrash });
    await next.ready;
    child = next;
  }

  function onCrash(): void {
    child = null;
    park();
  }

  function park(): void {
    printer.info('__Waiting for changes...__');
  }

  async function resolvePort(): Promise<number> {
    const configured = useEnv().get('PORT') ?? useConfig().server.port ?? DEFAULT_PORT;
    return configured === 0 ? freePort() : configured;
  }

  function close(): Promise<void> {
    return (closing ??= teardown());
  }

  async function teardown(): Promise<void> {
    schedule.cancel();
    watch.close();
    if (child) {
      const previous = child;
      child = null;
      await previous.stop();
    }
  }
}

function isSource(path: string): boolean {
  return SOURCE.has(extname(path));
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once('error', reject);
    probe.listen(0, () => {
      const { port } = probe.address() as { port: number };
      probe.close(() => resolve(port));
    });
  });
}
