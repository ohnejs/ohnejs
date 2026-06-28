import { createServer } from 'node:net';

import { debounce, extname, isNull, normalizeBasePath } from '../../utils/index.ts';
import { useEnv } from '../env/use-env.ts';
import { reportError } from '../error/report-error.ts';
import { DEFAULT_API_PORT, DEFAULT_DASHBOARD_PORT } from '../layers/config.ts';
import { loadLayers } from '../layers/load-layers.ts';
import { useConfig } from '../layers/use-config.ts';
import { onShutdown } from '../lifecycle/on-shutdown.ts';
import { useShutdown } from '../lifecycle/use-shutdown.ts';
import { usePrinter } from '../printer/use-printer.ts';
import { type ServeChild, spawnServeChild } from './child-server.ts';
import { createConfigTarget } from './targets/config.ts';
import { createMessagesTarget } from './targets/messages.ts';
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
   * Stops watching and drains the running children, resolving once they have exited.
   * Idempotent.
   */
  close(): Promise<void>;
}

/**
 * Options for `dev`.
 */
export interface DevOptions {
  /**
   * CLI entry to spawn the server children with, as `node <entry> serve <backend>`.
   *
   * @default
   * process.argv[1]
   */
  entry?: string;

  /**
   * Whether to also serve the dashboard alongside the API.
   *
   * @default
   * true
   */
  dashboard?: boolean;
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
 * It also serves the dashboard as a second child, unless `options.dashboard` is `false`.
 * The dashboard reads its modules from disk per request, so it never reloads; it only stops on teardown.
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
  const messages = createMessagesTarget(from);
  const config = createConfigTarget(from, [routes, middleware, messages]);
  const targets = [routes, middleware, messages];
  const port = await resolvePort();

  let api: ServeChild | null = null;
  let dashboard: ServeChild | null = null;
  const pending = new Set<string>();
  let cycling = false;
  let rerun = false;

  if (options.dashboard ?? true) await startDashboard();

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
    } catch {}
  }
  park();

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
      park();
      return;
    }
    const paths = [...batch];
    if (!paths.some(isSource) && !paths.some((path) => messages.affectedBy(path))) return;
    printer.info('__Reloading API...__');
    try {
      await respawn();
    } catch {}
    park();
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
    if (api) {
      const previous = api;
      api = null;
      await previous.stop();
    }
    const next = spawnServeChild(from, 'api', { port, entry: options.entry, onExit: onCrash });
    await next.ready;
    api = next;
  }

  async function startDashboard(): Promise<void> {
    const api = useConfig().api;
    try {
      dashboard = spawnServeChild(from, 'dashboard', {
        port: useConfig().dashboard?.port ?? DEFAULT_DASHBOARD_PORT,
        entry: options.entry,
        onExit: onDashboardExit,
        env: {
          API_URL: `http://${api.host ?? 'localhost'}:${port}${normalizeBasePath(api.basePath)}`,
        },
      });
      await dashboard.ready;
    } catch (error) {
      dashboard = null;
      reportError(error);
    }
  }

  function onCrash(): void {
    api = null;
    park();
  }

  function onDashboardExit(): void {
    dashboard = null;
    printer.warn('Dashboard server exited.');
  }

  function park(): void {
    printer.info('__Waiting for changes...__');
  }

  async function resolvePort(): Promise<number> {
    const configured = useEnv().get('PORT') ?? useConfig().api.port ?? DEFAULT_API_PORT;
    return configured === 0 ? freePort() : configured;
  }

  function close(): Promise<void> {
    return (closing ??= teardown());
  }

  async function teardown(): Promise<void> {
    schedule.cancel();
    watch.close();
    const running: ServeChild[] = [];
    if (api) running.push(api);
    if (dashboard) running.push(dashboard);
    api = null;
    dashboard = null;
    await Promise.all(running.map((c) => c.stop()));
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
