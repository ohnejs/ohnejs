import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import { pathToFileURL } from 'node:url';

import { exists } from '../../utils/fs/index.ts';
import { isNull, isPort, isString, joinPath, MAX_PORT } from '../../utils/index.ts';
import { bootLayers } from '../boot/boot-layers.ts';
import { codegenDir } from '../codegen/codegen-dir.ts';
import { generateDatabase } from '../codegen/generate-database.ts';
import { generateLayerName } from '../codegen/generate-layer-name.ts';
import { generateMessages } from '../codegen/generate-messages.ts';
import { generateMiddleware } from '../codegen/generate-middleware.ts';
import { generateResolvedConfig } from '../codegen/generate-resolved-config.ts';
import { generateRoutes } from '../codegen/generate-routes.ts';
import { pruneCodegen } from '../codegen/prune-codegen.ts';
import { useCollections } from '../collections/use-collections.ts';
import { connect } from '../database/connect.ts';
import { useMigrations } from '../database/migrations/use-migrations.ts';
import { buildDesiredSchema } from '../database/schema/desired.ts';
import { syncDatabase } from '../database/schema/sync.ts';
import { closeDatabases, useDatabase } from '../database/use-database.ts';
import { useEnv } from '../env/use-env.ts';
import { ohneError } from '../error/ohne-error.ts';
import { useFields } from '../fields/use-fields.ts';
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
import { useRoutes } from '../routes/use-routes.ts';

declare module 'ohne' {
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
 * Boot registers each layer's hooks and startup side effects before the server is built.
 * Files an earlier run left in the codegen dir are pruned, so it holds exactly the current output.
 * Codegen is skipped when the `SKIP_CODEGEN` env is truthy.
 *
 * The generated `routes.ts` is then imported to populate `useRoutes` with live handlers.
 * The database connects and its schema syncs before the server is built, so a failed sync never serves.
 * The server is built from that table, started, and wired to graceful shutdown through `onShutdown`.
 * Once it is listening, the `server:ready` hook runs before readiness is announced.
 * The listening socket and the shutdown signal funnel keep the process alive after this resolves.
 * With an IPC parent, it signals `'ready'` after the funnel is watching, so a supervisor can drive reloads.
 *
 * Port and host come from `Config.api`, overridden by the `PORT` and `HOST` env vars when set.
 * The app root is the nearest `package.json` above `from` (default `process.cwd()`).
 */
export async function serveAPI(from: string = process.cwd()): Promise<HTTPServer> {
  await loadLayers(from);
  await bootLayers();

  if (!useEnv().get('SKIP_CODEGEN')) {
    const written = (
      await Promise.all([
        generateLayerName(from),
        generateResolvedConfig(from),
        generateRoutes(from),
        generateMiddleware(from),
        generateMessages(from),
        generateDatabase(from),
      ])
    )
      .flat()
      .filter(isString);
    await pruneCodegen(from, written);
  }

  // The component tables live in the node bucket: importing runs the registrations.
  const dir = await codegenDir(from);
  if (!isNull(dir)) {
    for (const name of [
      'node/routes.ts',
      'node/middleware.ts',
      'node/messages.ts',
      'node/database.ts',
    ]) {
      const file = joinPath(dir, name);
      if (await exists(file)) await import(pathToFileURL(file).href);
    }
  }

  const dialect = await connect();
  const database = useConfig().database;
  const force = useEnv().has('FORCE_SYNC')
    ? useEnv().get('FORCE_SYNC')
    : (database?.sync?.force ?? false);
  const report = await syncDatabase(useDatabase(), dialect, {
    desired: buildDesiredSchema(useCollections(), useFields()),
    migrations: Object.values(useMigrations().all()),
    force,
  });
  if (report.deletions.length > 0) {
    usePrinter().warnBlock({ title: 'Sync removed data under `force`', body: report.deletions });
  }
  if (report.warnings.length > 0) {
    usePrinter().warnBlock({
      title: 'Pre-existing orphan rows',
      body: [...report.warnings, '', 'Set `FORCE_SYNC` or `database.sync.force` to purge them.'],
    });
  }

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
  useShutdown().watch({ deadline: offToUndefined(config.deadline) });

  await applyHook('server:ready', { host: host ?? 'localhost', port: address.port });

  usePrinter().success(`API ready at \`http://${host ?? 'localhost'}:${address.port}\``);
  process.send?.('ready');
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
