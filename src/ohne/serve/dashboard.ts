import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import { fileURLToPath } from 'node:url';

import type { HandlerContext, Route } from '../routes/route.ts';

import {
  dirname,
  isNull,
  isPathInside,
  isPort,
  jsonForScript,
  MAX_PORT,
  normalizeBasePath,
  type PageRoute,
  resolvePath,
  safeResolve,
} from '../../utils/index.ts';
import { buildDashboardPageManifest } from '../dashboard/build-dashboard-page-manifest.ts';
import { collectDashboardPages } from '../dashboard/collect-dashboard-pages.ts';
import { dashboardRoots } from '../dashboard/dashboard-roots.ts';
import { useEnv } from '../env/use-env.ts';
import { ohneError } from '../error/ohne-error.ts';
import { notFound } from '../http/http-error.ts';
import { createRouter } from '../http/router.ts';
import { type EventStream, sendEvents } from '../http/send-events.ts';
import { sendFile } from '../http/send-file.ts';
import { createServer, type HTTPServer } from '../http/server.ts';
import { shutdownServer } from '../http/shutdown-server.ts';
import { DEFAULT_API_PORT, DEFAULT_DASHBOARD_PORT } from '../layers/config.ts';
import { loadLayers } from '../layers/load-layers.ts';
import { useConfig } from '../layers/use-config.ts';
import { onShutdown } from '../lifecycle/on-shutdown.ts';
import { useShutdown } from '../lifecycle/use-shutdown.ts';
import { usePrinter } from '../printer/use-printer.ts';
import { resolveOhneLayers } from '../project/resolve-ohne-layers.ts';

/**
 * URL prefix under which the framework's browser modules are served.
 */
const MODULE_BASE = '/m';

/**
 * URL prefix under which each layer's dashboard modules are served, merged closer-layer-first.
 */
const APP_MODULE_BASE = `${MODULE_BASE}/app`;

/**
 * Path of the dev live-reload event stream the browser subscribes to, gated by `DASHBOARD_RELOAD`.
 */
const RELOAD_PATH = `${MODULE_BASE}/dashboard/reload`;

/**
 * Maps the bare specifiers a page may import to their served URLs, injected as the shell's importmap.
 * `ohne/utils` serves the full utils barrel, so a page or layer can import any isomorphic util by name.
 */
const IMPORTMAP = jsonForScript({
  imports: {
    'ohne/dashboard': `${MODULE_BASE}/dashboard/index.ts`,
    'ohne/utils': `${MODULE_BASE}/utils/index.ts`,
    'app/': `${APP_MODULE_BASE}/`,
  },
});

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
 * Resolves the layer stack, then serves a single-page shell on every navigation.
 * The shell injects the page manifest, scanned per request, plus an importmap, and boots the client kernel.
 * The framework kernel is served under `/m/`, each layer's dashboard modules under `/m/app/`.
 * Both are type-stripped to JavaScript: the dashboard is a pure SPA with no build step.
 *
 * Port and host come from `Config.dashboard`, overridden by the `PORT` and `HOST` env vars when set.
 * The injected API base URL comes from the `API_URL` env, then `Config.dashboard.apiURL`, then `Config.api`.
 * The app root is the nearest `package.json` above `from`.
 * The listening socket and the shutdown funnel keep the process alive after this resolves.
 */
export async function serveDashboard(from: string = process.cwd()): Promise<HTTPServer> {
  await loadLayers(from);
  const config = useConfig().dashboard;

  const layers = await resolveOhneLayers(from);
  const appRoots = dashboardRoots(layers);
  const apiURL = resolveAPIURL();
  const reload = useEnv().get('DASHBOARD_RELOAD');

  const renderShell = async (): Promise<string> =>
    shellDocument(
      apiURL,
      buildDashboardPageManifest(await collectDashboardPages(layers), APP_MODULE_BASE),
      reload,
    );

  const routes: Route[] = [
    synthetic('/', renderShell),
    synthetic('/[...path]', renderShell),
    synthetic(`${APP_MODULE_BASE}/[...path]`, ({ params }: HandlerContext) =>
      sendFile(appRoots, params.path, { notFound: 'Not Found' }),
    ),
    synthetic(`${MODULE_BASE}/[...path]`, serveModule),
  ];
  if (reload) liveReload(routes);
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

/**
 * Wires the dev live-reload channel onto `routes`.
 *
 * Adds the event-stream route the browser subscribes to and tracks every open stream.
 * A `'reload'` IPC message from the dev supervisor, sent on a dashboard-file change, broadcasts to them.
 * On shutdown the streams close first, so an idle one never holds the server's drain open.
 */
function liveReload(routes: Route[]): void {
  const clients = new Set<EventStream>();
  routes.push(
    synthetic(RELOAD_PATH, () => {
      const stream = sendEvents({ onClose: () => clients.delete(stream) });
      clients.add(stream);
      return stream.body;
    }),
  );
  const onMessage = (message: unknown): void => {
    if (message === 'reload') for (const client of clients) client.send('reload');
  };
  process.on('message', onMessage);
  onShutdown(() => {
    process.off('message', onMessage);
    for (const client of clients) client.close();
  });
}

function resolveAPIURL(): string {
  const api = useConfig().api;
  return (
    useEnv().get('API_URL') ??
    useConfig().dashboard?.apiURL ??
    `http://${api.host ?? 'localhost'}:${api.port ?? DEFAULT_API_PORT}${normalizeBasePath(api.basePath)}`
  );
}

function shellDocument(apiURL: string, pages: PageRoute[], reload: boolean): string {
  const config = jsonForScript({ apiURL, pages });
  const reloadClient = reload
    ? `\n    <script type="module" src="${MODULE_BASE}/dashboard/runtime/reload-client.ts"></script>`
    : '';
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>ohne</title>
    <script type="importmap">${IMPORTMAP}</script>
  </head>
  <body>
    <div id="app"></div>
    <script type="application/json" id="ohne-config">${config}</script>
    <script type="module" src="${MODULE_BASE}/dashboard/boot.ts"></script>${reloadClient}
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
