import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import { fileURLToPath } from 'node:url';

import type { HandlerContext, Route } from '../routes/route.ts';

import {
  dirname,
  isNull,
  isPathInside,
  isPort,
  MAX_PORT,
  normalizeBasePath,
  resolvePath,
  safeResolve,
} from '../../utils/index.ts';
import { useEnv } from '../env/use-env.ts';
import { ohneError } from '../error/ohne-error.ts';
import { notFound } from '../http/http-error.ts';
import { createRouter } from '../http/router.ts';
import { sendFile } from '../http/send-file.ts';
import { createServer, type HTTPServer } from '../http/server.ts';
import { shutdownServer } from '../http/shutdown-server.ts';
import { DEFAULT_API_PORT, DEFAULT_DASHBOARD_PORT } from '../layers/config.ts';
import { loadLayers } from '../layers/load-layers.ts';
import { useConfig } from '../layers/use-config.ts';
import { onShutdown } from '../lifecycle/on-shutdown.ts';
import { useShutdown } from '../lifecycle/use-shutdown.ts';
import { usePrinter } from '../printer/use-printer.ts';

const MODULE_BASE = '/m';

/**
 * The framework `src` directory, the root the client modules are served from.
 * Resolved from this file's location: `src/ohne/serve` up two is `src`.
 */
const SRC_ROOT = resolvePath('../..', dirname(fileURLToPath(import.meta.url)));

/**
 * The framework subtrees the browser graph may load: the dashboard kernel and the utils it imports.
 * Everything else under `src` (the Node framework internals) is off-limits to the browser.
 */
const MODULE_ROOTS = ['dashboard', 'utils'].map((dir) => resolvePath(dir, SRC_ROOT));

/**
 * Boots the dashboard server for the project rooted at `from` and starts serving it.
 *
 * Resolves the layer stack for config, then serves a single-page shell on every navigation.
 * The client modules under `/m/` are served type-stripped to JavaScript.
 * The dashboard is a pure SPA: the browser fetches each module and renders with the reactive client kernel.
 *
 * Port and host come from `Config.dashboard`, overridden by the `PORT` and `HOST` env vars when set.
 * The injected API base URL comes from the `API_URL` env, then `Config.dashboard.apiURL`, then `Config.api`.
 * The app root is the nearest `package.json` above `from`.
 * The listening socket and the shutdown funnel keep the process alive after this resolves.
 */
export async function serveDashboard(from: string = process.cwd()): Promise<HTTPServer> {
  await loadLayers(from);
  const config = useConfig().dashboard;

  const shell = shellDocument(resolveAPIURL());
  const routes: Route[] = [
    synthetic('/', () => shell),
    synthetic('/[...path]', () => shell),
    synthetic(`${MODULE_BASE}/[...path]`, serveModule),
  ];
  const http = createServer(createRouter(routes));

  const port = useEnv().get('PORT') ?? config?.port ?? DEFAULT_DASHBOARD_PORT;
  if (!isPort(port)) {
    throw ohneError({
      title: 'Invalid dashboard port',
      body: [`Port must be an integer between \`0\` and \`${MAX_PORT}\`.`, `You set \`${port}\`.`],
    });
  }
  const host = useEnv().get('HOST') ?? config?.host;

  onShutdown(() => shutdownServer(http.server, http.gate));

  const address = await listen(http.server, port, host);
  useShutdown().watch({});

  usePrinter().success(`Dashboard ready at \`http://${host ?? 'localhost'}:${address.port}\``);
  process.send?.('ready');
  return http;
}

function synthetic(pattern: string, handler: Route['handler']): Route {
  return { method: 'GET', pattern, file: '', layer: '', handler };
}

function serveModule({ params }: HandlerContext): Promise<string | undefined> {
  const resolved = safeResolve(SRC_ROOT, params.path);
  if (isNull(resolved) || !MODULE_ROOTS.some((root) => isPathInside(resolved, root))) {
    throw notFound('Not Found');
  }
  return sendFile([SRC_ROOT], params.path, { notFound: 'Not Found' });
}

function resolveAPIURL(): string {
  const api = useConfig().api;
  return (
    useEnv().get('API_URL') ??
    useConfig().dashboard?.apiURL ??
    `http://${api.host ?? 'localhost'}:${api.port ?? DEFAULT_API_PORT}${normalizeBasePath(api.basePath)}`
  );
}

function shellDocument(apiURL: string): string {
  const config = JSON.stringify({ apiURL }).replace(/</g, '\\u003c');
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>ohne</title>
  </head>
  <body>
    <div id="app"><h1>ohne</h1></div>
    <script type="application/json" id="ohne-config">${config}</script>
  </body>
</html>
`;
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
