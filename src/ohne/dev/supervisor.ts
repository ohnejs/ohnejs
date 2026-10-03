import { watch } from 'node:fs';

import { debounce, extname, isNull, joinPath, normalizeBasePath } from '../../utils/index.ts';
import { listenOrigin } from '../../utils/net/index.ts';
import { pruneCodegen } from '../codegen/prune-codegen.ts';
import { useEnv } from '../env/use-env.ts';
import { reportError } from '../error/report-error.ts';
import { DEFAULT_API_PORT, DEFAULT_DASHBOARD_PORT } from '../layers/config.ts';
import { loadLayers } from '../layers/load-layers.ts';
import { useConfig } from '../layers/use-config.ts';
import { onShutdown } from '../lifecycle/on-shutdown.ts';
import { useShutdown } from '../lifecycle/use-shutdown.ts';
import { usePrinter } from '../printer/use-printer.ts';
import { loadProjectEnv } from '../project/load-project-env.ts';
import {
  type ChildExit,
  type ServeBackend,
  type ServeChild,
  spawnServeChild,
} from './child-server.ts';
import { isDashboardPath } from './is-dashboard-path.ts';
import { resolveDevPorts } from './resolve-ports.ts';
import { createConfigTarget } from './targets/config.ts';
import { createDatabaseTarget } from './targets/database.ts';
import { createFlowsTarget } from './targets/flows.ts';
import { createMessagesTarget } from './targets/messages.ts';
import { createMiddlewareTarget } from './targets/middleware.ts';
import { createRegistryTarget } from './targets/registry.ts';
import { createRolesTarget } from './targets/roles.ts';
import { createRoutesTarget } from './targets/routes.ts';
import { createSkillsTarget } from './targets/skills.ts';
import { watchLayers } from './watch-layers.ts';

const DEBOUNCE = 100;
const REVIVE_UPTIME = 5_000;
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
 * Watches the project and reloads `ohne serve api` when a change affects it.
 *
 * The `.env` at `from` is read first, so the ports resolve from it and both children inherit it.
 * A `.env` change reloads it here and restarts both children, so they inherit the new values.
 * Owns codegen, then spawns the server as a child with `SKIP_CODEGEN` so the child only serves.
 * The initial build writes the full set and prunes stale files from the codegen dir.
 * A change re-runs its codegen; an API source, message, or `.env` change also drains and respawns the child.
 * An `ohne.config.ts` change refreshes the registry first, as a barrier, so every table is rebuilt.
 *
 * Codegen failures and child crashes never tear the supervisor down.
 * It prints, waits for the next change, then revives once a respawn reaches `'ready'`.
 * A ready child stopped from outside, by a signal or a clean exit, warns and restarts at once.
 * One that stops within seconds of its start warns and waits for a change instead, so a crash never loops.
 * A child that never signals ready is killed after a minute and parks the supervisor the same way.
 *
 * It also serves the dashboard as a second child, unless `options.dashboard` is `false`.
 * The dashboard child reads its modules from disk per request, so a file change never respawns a running one.
 * A config change does: the child resolved the layer stack at boot, and a listed layer may have changed.
 * A dashboard that fails to start or exits prints its own error, and any next change starts it again.
 * A change in a dashboard directory tells its browsers to reload over the dev live-reload stream.
 * That reload follows any API respawn the same batch caused, so the reloaded page finds the API ready.
 *
 * The app root is the nearest `package.json` above `from` (default `process.cwd()`).
 */
export async function dev(
  from: string = process.cwd(),
  options: DevOptions = {},
): Promise<DevServer> {
  const printer = usePrinter();
  await loadProjectEnv(from);
  await loadLayers(from);

  const registry = createRegistryTarget(from);
  const routes = createRoutesTarget(from);
  const middleware = createMiddlewareTarget(from);
  const messages = createMessagesTarget(from);
  const database = createDatabaseTarget(from);
  const roles = createRolesTarget(from);
  const skills = createSkillsTarget(from);
  const flows = createFlowsTarget(from);
  const config = createConfigTarget(from, [
    registry,
    routes,
    middleware,
    messages,
    database,
    roles,
    skills,
    flows,
  ]);
  const targets = [registry, routes, middleware, messages, database, roles, skills, flows];

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
  let browserReload = false;
  let watching = false;
  const revive = new Set<ServeBackend>();

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
  const layerWatch = watchLayers((path) => {
    pending.add(path);
    schedule();
  });
  // The layer watch prunes dotfiles, so the root `.env` needs its own watch.
  const envFile = joinPath(from, '.env');
  const envWatch = watch(from, (_event, name) => {
    if (name !== '.env') return;
    pending.add(envFile);
    schedule();
  });
  envWatch.on('error', () => envWatch.close());
  watching = true;
  if (revive.size > 0) schedule();

  let closing: Promise<void> | undefined;
  onShutdown(close);
  useShutdown().watch();
  return { close };

  /**
   * Drains `pending` and `revive` cycle by cycle until both stay empty.
   * A call during a running cycle only flags a rerun.
   */
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
        if (batch.size === 0 && revive.size === 0) break;
        await runCycle(batch);
      } while (!closed && (rerun || pending.size > 0 || revive.size > 0));
    } finally {
      cycling = false;
    }
  }

  /**
   * Reloads a changed `.env`, regenerates, then restarts, reloads, or respawns only what the batch affects.
   * A child in `revive` restarts with an empty batch too.
   * A `.env` or codegen failure is reported and parks the supervisor, leaving the children as they are.
   * The API respawns first, so a browser reload or a dashboard restart never meets a restarting API.
   * A missing dashboard starts again on any change.
   * A browser reload with no API child to serve it waits for the change that brings one back.
   */
  async function runCycle(batch: Set<string>): Promise<void> {
    const revivesAPI = revive.delete('api');
    revive.clear();
    const configChanged = [...batch].some((path) => config.affectedBy(path));
    const envChanged = batch.has(envFile);
    try {
      if (envChanged) await loadProjectEnv(from);
      await regen(batch);
    } catch (error) {
      reportError(error);
      park();
      return;
    }
    if (closed) return;
    const reloadable = [...batch].filter((path) => !isDashboardPath(path));
    if (reloadable.length < batch.size) browserReload = true;
    const changesAPI =
      envChanged ||
      reloadable.some(isSource) ||
      reloadable.some((path) => messages.affectedBy(path));
    const reloads = changesAPI || revivesAPI;
    const startsDashboard = wantDashboard && (configChanged || envChanged || isNull(dashboard));
    if (reloads) {
      if (changesAPI) printer.info('__Reloading API...__');
      try {
        await respawn();
      } catch {}
    }
    if (startsDashboard) {
      browserReload = false;
      await restartDashboard();
    } else if (browserReload && !isNull(api)) {
      browserReload = false;
      dashboard?.reload();
    }
    if (reloads || startsDashboard) park();
  }

  /**
   * Runs every target and prunes stale files for `null`, else only the targets a path in `batch` affects.
   * A config change runs the config target alone, which rebuilds the rest, then resyncs the layer watch.
   */
  async function regen(batch: Set<string> | null): Promise<void> {
    if (isNull(batch)) {
      const written = (await Promise.all(targets.map((target) => target.regen()))).flat();
      await pruneCodegen(from, written);
      return;
    }
    const paths = [...batch];
    if (paths.some((path) => config.affectedBy(path))) {
      await config.regen();
      if (!closed) layerWatch.resync();
      return;
    }
    for (const target of targets) {
      if (paths.some((path) => target.affectedBy(path))) await target.regen();
    }
  }

  /**
   * Stops the running API child, then spawns a fresh one, rejecting when its boot fails.
   */
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

  /**
   * Hands the API child the dashboard's origin as `DASHBOARD_URL`, or nothing when the dashboard is off.
   */
  function apiChildEnv(): Record<string, string> {
    if (!wantDashboard) return {};
    const origin =
      useEnv().get('DASHBOARD_URL') ??
      useConfig().dashboard?.origin ??
      listenOrigin(useEnv().get('HOST') ?? useConfig().dashboard?.host, dashboardPort);
    return { DASHBOARD_URL: origin };
  }

  /**
   * Spawns the dashboard child pointed at the API; a failed boot leaves no dashboard.
   * The child prints its own failure, and the next change starts it again.
   */
  async function startDashboard(): Promise<void> {
    const config = useConfig();
    const env = useEnv();
    const api = config.api;
    const derivedURL =
      listenOrigin(env.get('HOST') ?? api.host, port) + normalizeBasePath(api.basePath);
    try {
      dashboard = spawnServeChild(from, 'dashboard', {
        port: dashboardPort,
        entry: options.entry,
        onExit: onDashboardExit,
        env: {
          API_URL: env.get('API_URL') ?? config.dashboard?.apiURL ?? derivedURL,
          DASHBOARD_RELOAD: env.has('DASHBOARD_RELOAD') ? String(env.get('DASHBOARD_RELOAD')) : '1',
        },
      });
      await dashboard.ready;
    } catch {
      dashboard = null;
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

  /**
   * Drops a crashed API child, then revives or parks it.
   */
  function onCrash(exit: ChildExit): void {
    api = null;
    onChildExit('api', exit);
  }

  /**
   * Drops an exited dashboard child, then revives or parks it.
   */
  function onDashboardExit(exit: ChildExit): void {
    dashboard = null;
    onChildExit('dashboard', exit);
  }

  /**
   * Queues a child stopped from outside for a restart, else parks until a change brings it back.
   * A non-zero exit code means the child printed its own failure, so it parks without a word.
   * An exit during shutdown is the shutdown itself, so it does nothing.
   */
  function onChildExit(backend: ServeBackend, { code, signal, uptime }: ChildExit): void {
    if (closed || useShutdown().state !== 'idle') return;
    if (code) return park();
    const name = backend === 'api' ? 'API' : 'Dashboard';
    const stopped = signal ? `${name} stopped by \`${signal}\`` : `${name} stopped`;
    if (uptime < REVIVE_UPTIME) {
      printer.warn(`${stopped} right after it started.`);
      return park();
    }
    printer.warn(`${stopped}. Restarting...`);
    revive.add(backend);
    if (watching) schedule();
  }

  /**
   * Prints the dim line that marks the supervisor idle until the next change.
   */
  function park(): void {
    printer.info('__Waiting for changes...__');
  }

  /**
   * Starts the teardown once; every later call returns the same promise.
   */
  function close(): Promise<void> {
    return (closing ??= teardown());
  }

  /**
   * Closes the layer and `.env` watches, waits out any cycle or respawn in flight, then stops the children.
   */
  async function teardown(): Promise<void> {
    closed = true;
    schedule.cancel();
    layerWatch.close();
    envWatch.close();
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
