import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import { pathToFileURL } from 'node:url';

import { exists } from '../../utils/fs/index.ts';
import { isNull, isPort, joinPath, MAX_PORT } from '../../utils/index.ts';
import { bootLayers } from '../boot/boot-layers.ts';
import { codegenDir } from '../codegen/codegen-dir.ts';
import { generateLayerName } from '../codegen/generate-layer-name.ts';
import { generateMiddleware } from '../codegen/generate-middleware.ts';
import { generateResolvedConfig } from '../codegen/generate-resolved-config.ts';
import { generateRoutes } from '../codegen/generate-routes.ts';
import { useEnv } from '../env/use-env.ts';
import { createRouter } from '../http/router.ts';
import { createServer, type HTTPServer } from '../http/server.ts';
import { shutdownServer } from '../http/shutdown-server.ts';
import { DEFAULT_PORT, offToUndefined } from '../layers/config.ts';
import { loadLayers } from '../layers/load-layers.ts';
import { useConfig } from '../layers/use-config.ts';
import { onShutdown } from '../lifecycle/on-shutdown.ts';
import { useShutdown } from '../lifecycle/use-shutdown.ts';
import { usePrinter } from '../printer/use-printer.ts';
import { useRoutes } from '../routes/use-routes.ts';

/**
 * Boots the API backend for the project rooted at `from` and starts serving it.
 *
 * Resolves and registers the layer stack, runs every layer's boot files, then regenerates types.
 * Boot runs before codegen so the hooks codegen consults are already registered.
 * Codegen is skipped when the `SKIP_CODEGEN` env is truthy.
 *
 * The generated `routes.ts` is then imported to populate `useRoutes` with live handlers.
 * The server is built from that table, started, and wired to graceful shutdown through `onShutdown`.
 * The listening socket and the shutdown signal funnel keep the process alive after this resolves.
 * With an IPC parent, it signals `'ready'` after the funnel is watching, so a supervisor can drive reloads.
 *
 * Port and host come from `Config.server`, overridden by the `PORT` and `HOST` env vars when set.
 * The app root is the nearest `package.json` above `from` (default `process.cwd()`).
 */
export async function serveAPI(from: string = process.cwd()): Promise<HTTPServer> {
  await loadLayers(from);
  await bootLayers();

  if (!useEnv().get('SKIP_CODEGEN')) {
    await Promise.all([
      generateLayerName(from),
      generateResolvedConfig(from),
      generateMiddleware(from),
      generateRoutes(from),
    ]);
  }

  // The route and middleware tables live in generated files: importing them runs the registrations.
  const dir = await codegenDir(from);
  if (!isNull(dir)) {
    for (const name of ['middleware.ts', 'routes.ts']) {
      const file = joinPath(dir, name);
      if (await exists(file)) await import(pathToFileURL(file).href);
    }
  }

  const config = useConfig().server;
  const http = createServer(createRouter(Object.values(useRoutes().all())), {
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

  const port = useEnv().get('PORT') ?? config.port ?? DEFAULT_PORT;
  if (!isPort(port)) {
    throw new Error(`Invalid server port: ${port}. Must be an integer between 0 and ${MAX_PORT}.`);
  }
  const host = useEnv().get('HOST') ?? config.host;

  onShutdown(() => usePrinter().info('Shutting down'));
  onShutdown(() =>
    shutdownServer(http.server, http.gate, {
      preStopDelay: offToUndefined(config.preStopDelay),
      shutdownTimeout: offToUndefined(config.shutdownTimeout),
    }),
  );

  const address = await listen(http.server, port, host);
  useShutdown().watch({ deadline: offToUndefined(config.deadline) });
  process.send?.('ready');

  usePrinter().info(`Listening on "http://${host ?? 'localhost'}:${address.port}"`);
  return http;
}

function listen(server: Server, port: number, host?: string): Promise<AddressInfo> {
  return new Promise((resolve, reject) => {
    const onError = (error: Error): void => reject(error);
    server.once('error', onError);
    server.listen(port, host, () => {
      server.removeListener('error', onError);
      resolve(server.address() as AddressInfo);
    });
  });
}
