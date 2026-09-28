import { isPort, MAX_PORT } from '../../utils/index.ts';
import { listenOrigin } from '../../utils/net/index.ts';
import { bootProject } from '../boot/boot-project.ts';
import { syncProjectDatabase } from '../database/sync-project.ts';
import { closeDatabases } from '../database/use-database.ts';
import { useEnv } from '../env/use-env.ts';
import { ohneError } from '../error/ohne-error.ts';
import { applyHook } from '../hooks/apply-hook.ts';
import { createRouter } from '../http/router.ts';
import { createServer, type HTTPServer } from '../http/server.ts';
import { shutdownServer } from '../http/shutdown-server.ts';
import { DEFAULT_API_PORT, offToUndefined } from '../layers/config.ts';
import { loadLayers } from '../layers/load-layers.ts';
import { useConfig } from '../layers/use-config.ts';
import { onShutdown } from '../lifecycle/on-shutdown.ts';
import { useShutdown } from '../lifecycle/use-shutdown.ts';
import { usePrinter } from '../printer/use-printer.ts';
import { loadProjectEnv } from '../project/load-project-env.ts';
import { useRoutes } from '../routes/use-routes.ts';
import { listen } from './_listen.ts';

declare module 'ohnejs' {
  interface Hooks {
    /**
     * Runs once the API server is listening, after the socket accepts and before readiness is announced.
     * Receives the bound `host` and `port`; read `port` to learn the real port when `api.port` is `0`.
     * Register it from a boot file to warm a cache, open a pool, or announce the address to discovery.
     * An action: its return is ignored, and a throw aborts startup through the error funnel.
     * For teardown, use `onShutdown` instead.
     */
    'server:ready': (info: { host: string; port: number }) => void | Promise<void>;
  }
}

/**
 * Boots the API backend for the project rooted at `from` and starts serving it.
 *
 * Resolves and registers the layer stack, runs every layer's boot files, then regenerates types.
 * Codegen is skipped when the `SKIP_CODEGEN` env is truthy.
 * A skipped codegen still warns when another ohne version generated the files.
 *
 * The database connects and its schema syncs before the server is built, so a failed sync never serves.
 * The server is then started and wired to graceful shutdown through `onShutdown`.
 * Once it is listening, the `server:ready` hook runs before readiness is announced.
 * A hook that throws drains the server and rethrows, so a half-booted process exits instead of serving.
 * The listening socket and the shutdown signal funnel keep the process alive after this resolves.
 * With an IPC parent, it signals `'ready'` after the funnel is watching, so a supervisor can drive reloads.
 *
 * Port and host come from `Config.api`, overridden by the `PORT` and `HOST` env vars when set.
 * The `.env` at `from` fills the environment first, so every config and boot file sees it.
 * The app root is the nearest `package.json` above `from` (default `process.cwd()`).
 */
export async function serveAPI(from: string = process.cwd()): Promise<HTTPServer> {
  await loadProjectEnv(from);
  await loadLayers(from);
  await bootProject(from);
  await syncProjectDatabase();

  const config = useConfig().api;
  const http = createServer(createRouter(Object.values(useRoutes().all())), {
    basePath: config.basePath,
    headersTimeout: offToUndefined(config.headersTimeout),
    requestTimeout: offToUndefined(config.requestTimeout),
    keepAliveTimeout: offToUndefined(config.keepAliveTimeout),
    maxConnections: offToUndefined(config.maxConnections),
    maxHeaderSize: offToUndefined(config.maxHeaderSize),
    maxBodySize: offToUndefined(config.maxBodySize),
    handlerTimeout: offToUndefined(config.handlerTimeout),
    waitUntilTimeout: offToUndefined(config.waitUntilTimeout),
    trustProxy: config.trustProxy,
    allowedHosts: config.allowedHosts,
  });

  const port = useEnv().get('PORT') ?? config.port ?? DEFAULT_API_PORT;
  if (!isPort(port)) {
    throw ohneError({
      title: 'Invalid server port',
      body: [`Port must be an integer between \`0\` and \`${MAX_PORT}\`.`, `You set \`${port}\`.`],
    });
  }
  const host = useEnv().get('HOST') ?? config.host;

  onShutdown(() =>
    shutdownServer(http.server, http.gate, {
      preStopDelay: offToUndefined(config.preStopDelay),
      shutdownTimeout: offToUndefined(config.shutdownTimeout),
    }),
  );
  onShutdown(() => closeDatabases());

  const address = await listen(http.server, port, host);
  try {
    await applyHook('server:ready', { host: host ?? 'localhost', port: address.port });
  } catch (error) {
    await useShutdown().run({ deadline: offToUndefined(config.deadline) });
    throw error;
  }
  useShutdown().watch({ deadline: offToUndefined(config.deadline) });

  usePrinter().success(`API ready at \`${listenOrigin(host, address.port)}\``);
  if (process.connected) process.send?.('ready');
  return http;
}
