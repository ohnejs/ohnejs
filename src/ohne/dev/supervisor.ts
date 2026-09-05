import { debounce, extname, isNull, normalizeBasePath } from '../../utils/index.ts';
import { pruneCodegen } from '../codegen/prune-codegen.ts';
import { useEnv } from '../env/use-env.ts';
import { reportError } from '../error/report-error.ts';
import { DEFAULT_API_PORT, DEFAULT_DASHBOARD_PORT } from '../layers/config.ts';
import { loadLayers } from '../layers/load-layers.ts';
import { useConfig } from '../layers/use-config.ts';
import { onShutdown } from '../lifecycle/on-shutdown.ts';
import { useShutdown } from '../lifecycle/use-shutdown.ts';
import { usePrinter } from '../printer/use-printer.ts';
import { type ServeChild, spawnServeChild } from './child-server.ts';
import { isDashboardPath } from './is-dashboard-path.ts';
import { resolveDevPorts } from './resolve-ports.ts';
import { createConfigTarget } from './targets/config.ts';
import { createDatabaseTarget } from './targets/database.ts';
import { createMessagesTarget } from './targets/messages.ts';
import { createMiddlewareTarget } from './targets/middleware.ts';
import { createRegistryTarget } from './targets/registry.ts';
import { createRolesTarget } from './targets/roles.ts';
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
 * The initial build writes the full set and prunes stale files from the codegen dir.
 * A change re-runs the affected codegen, then drains the child and respawns it.
 * An `ohne.config.ts` change refreshes the registry first, as a barrier, so every table is rebuilt.
 *
 * Codegen failures and child crashes never tear the supervisor down.
 * It prints, waits for the next change, then revives once a respawn reaches `'ready'`.
 *
 * It also serves the dashboard as a second child, unless `options.dashboard` is `false`.
 * The dashboard child reads its modules from disk per request, so a file change never respawns it.
 * A config change does: the child resolved the layer stack at boot, and a listed layer may have changed.
 * A change in a dashboard directory tells its browsers to reload over the dev live-reload stream.
 *
 * The app root is the nearest `package.json` above `from` (default `process.cwd()`).
 */
export async function dev(
  from: string = process.cwd(),
  options: DevOptions = {},
): Promise<DevServer> {
  const printer = usePrinter();
  await loadLayers(from);

  const registry = createRegistryTarget(from);
  const routes = createRoutesTarget(from);
  const middleware = createMiddlewareTarget(from);
  const messages = createMessagesTarget(from);
  const database = createDatabaseTarget(from);
  const roles = createRolesTarget(from);
  const config = createConfigTarget(from, [
    registry,
    routes,
    middleware,
    messages,
    database,
    roles,
  ]);
  const targets = [registry, routes, middleware, messages, database, roles];

  const wantDashboard = options.dashboard ?? true;
  const { dashboard: dashboardPort, api: port } = await resolveDevPorts(
    {
      base: useEnv().get('PORT'),
      dashboard: useConfig().dashboard?.port ?? DEFAULT_DASHBOARD_PORT,
      api: useConfig().api.port ?? DEFAULT_API_PORT,
      serveDashboard: wantDashboard,
    },
    (busy) => printer.warn(`Port \`${busy}\` is already in use.`),
  );

  let api: ServeChild | null = null;
  let dashboard: ServeChild | null = null;
  let respawning: Promise<void> | undefined;
  let ticking: Promise<void> | undefined;
  const pending = new Set<string>();
  let cycling = false;
  let rerun = false;
  let closed = false;

  if (wantDashboard) await startDashboard();

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
  const schedule = debounce(() => void (ticking = tick()), DEBOUNCE);
  const watch = watchLayers((path) => {
    pending.add(path);
    schedule();
  });

  let closing: Promise<void> | undefined;
  onShutdown(close);
  useShutdown().watch();
  return { close };

  async function tick(): Promise<void> {
    if (closed) return;
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
      } while (!closed && (rerun || pending.size > 0));
    } finally {
      cycling = false;
    }
  }

  async function runCycle(batch: Set<string>): Promise<void> {
    const configChanged = [...batch].some((path) => config.affectedBy(path));
    try {
      await regen(batch);
    } catch (error) {
      reportError(error);
      park();
      return;
    }
    if (closed) return;
    if (configChanged && wantDashboard) await restartDashboard();
    const reloadable = [...batch].filter((path) => !isDashboardPath(path));
    if (reloadable.length < batch.size) dashboard?.reload();
    if (!reloadable.some(isSource) && !reloadable.some((path) => messages.affectedBy(path))) return;
    printer.info('__Reloading API...__');
    try {
      await respawn();
    } catch {}
    park();
  }

  async function regen(batch: Set<string> | null): Promise<void> {
    if (isNull(batch)) {
      const written = (await Promise.all(targets.map((target) => target.regen()))).flat();
      await pruneCodegen(from, written);
      return;
    }
    const paths = [...batch];
    if (paths.some((path) => config.affectedBy(path))) {
      await config.regen();
      if (!closed) watch.resync();
      return;
    }
    for (const target of targets) {
      if (paths.some((path) => target.affectedBy(path))) await target.regen();
    }
  }

  function respawn(): Promise<void> {
    respawning = (async () => {
      if (api) {
        const previous = api;
        api = null;
        await previous.stop();
      }
      const next = spawnServeChild(from, 'api', {
        port,
        entry: options.entry,
        onExit: onCrash,
        env: apiChildEnv(),
      });
      await next.ready;
      api = next;
    })();
    return respawning;
  }

  function apiChildEnv(): Record<string, string> {
    if (!wantDashboard) return {};
    const origin =
      useEnv().get('DASHBOARD_URL') ??
      useConfig().dashboard?.origin ??
      `http://localhost:${dashboardPort}`;
    return { DASHBOARD_URL: origin };
  }

  async function startDashboard(): Promise<void> {
    const config = useConfig();
    const api = config.api;
    const host = useEnv().get('HOST') ?? api.host ?? 'localhost';
    const derivedURL = `http://${host}:${port}${normalizeBasePath(api.basePath)}`;
    try {
      dashboard = spawnServeChild(from, 'dashboard', {
        port: dashboardPort,
        entry: options.entry,
        onExit: onDashboardExit,
        env: {
          API_URL: process.env['API_URL'] ?? config.dashboard?.apiURL ?? derivedURL,
          DASHBOARD_RELOAD: process.env['DASHBOARD_RELOAD'] ?? '1',
        },
      });
      await dashboard.ready;
    } catch {
      dashboard = null;
      printer.warn('Dashboard failed to start.');
    }
  }

  /**
   * Stops the dashboard child and starts a fresh one, so it resolves the layer stack again.
   * Its browsers reconnect to the live-reload stream and reload themselves on that reconnect.
   */
  async function restartDashboard(): Promise<void> {
    const previous = dashboard;
    dashboard = null;
    await previous?.stop();
    if (!closed) await startDashboard();
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

  function close(): Promise<void> {
    return (closing ??= teardown());
  }

  async function teardown(): Promise<void> {
    closed = true;
    schedule.cancel();
    watch.close();
    await ticking?.catch(() => {});
    await respawning?.catch(() => {});
    const running: ServeChild[] = [];
    if (api) running.push(api);
    if (dashboard) running.push(dashboard);
    api = null;
    dashboard = null;
    await Promise.all(running.map((c) => c.stop()));
  }
}

/**
 * Whether a changed file is API source, the kind of change that respawns the API child.
 */
function isSource(path: string): boolean {
  return SOURCE.has(extname(path));
}
