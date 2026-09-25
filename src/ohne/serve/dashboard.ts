import type { HandlerContext, Route } from '../routes/route.ts';

import { etag } from '../../utils/etag/etag.ts';
import { exists } from '../../utils/fs/index.ts';
import {
  cacheControl,
  canonicalizeLanguage,
  isNull,
  isPathInside,
  isPort,
  isUndefined,
  joinPath,
  jsonForScript,
  last,
  MAX_PORT,
  normalizeBasePath,
  type PageRoute,
  relativePath,
  resolvePath,
  safeResolve,
} from '../../utils/index.ts';
import { codegenDir } from '../codegen/codegen-dir.ts';
import { buildDashboardPageManifest } from '../dashboard/build-dashboard-page-manifest.ts';
import { collectDashboardBoot } from '../dashboard/collect-dashboard-boot.ts';
import { collectDashboardPages } from '../dashboard/collect-dashboard-pages.ts';
import { dashboardRoots } from '../dashboard/dashboard-roots.ts';
import { iconShape } from '../dashboard/icon-shapes.ts';
import { useEnv } from '../env/use-env.ts';
import { ohneError } from '../error/ohne-error.ts';
import { notFound } from '../http/http-error.ts';
import { isFresh } from '../http/is-fresh.ts';
import { createRouter } from '../http/router.ts';
import { type EventStream, sendEvents } from '../http/send-events.ts';
import { sendFile } from '../http/send-file.ts';
import { sendNotModified } from '../http/send-not-modified.ts';
import { createServer, type HTTPServer } from '../http/server.ts';
import { shutdownServer } from '../http/shutdown-server.ts';
import { useResponse } from '../http/use-response.ts';
import { DEFAULT_API_PORT, DEFAULT_DASHBOARD_PORT } from '../layers/config.ts';
import { loadLayers } from '../layers/load-layers.ts';
import { stackedLayers } from '../layers/stacked-layers.ts';
import { useConfig } from '../layers/use-config.ts';
import { onShutdown } from '../lifecycle/on-shutdown.ts';
import { useShutdown } from '../lifecycle/use-shutdown.ts';
import { SRC_ROOT } from '../meta/src-root.ts';
import { usePrinter } from '../printer/use-printer.ts';
import { loadProjectEnv } from '../project/load-project-env.ts';
import { listen } from './_listen.ts';

/**
 * URL prefix under which the framework's browser modules are served.
 */
const MODULE_BASE = '/m';

/**
 * URL prefix under which each layer's dashboard modules are served, merged closer-layer-first.
 */
const APP_MODULE_BASE = `${MODULE_BASE}/app`;

/**
 * URL prefix the dashboard server answers one icon shape under, as `/m/icon/<name>`.
 * `src/dashboard/ui/icon.ts` resolves it against its own served URL, so the two cannot drift.
 */
const ICON_BASE = `${MODULE_BASE}/icon`;

/**
 * How long a served shape stays fresh, in seconds.
 * A name's shape only changes when the vendored set is bumped, so a day of freshness costs nothing.
 * The `ETag` settles the rest.
 */
const ICON_MAX_AGE = 86_400;

/**
 * Path of the dev live-reload event stream the browser subscribes to, gated by `DASHBOARD_RELOAD`.
 */
const RELOAD_PATH = `${MODULE_BASE}/dashboard/reload`;

/**
 * Maps the bare specifiers a dashboard page may import to their served URLs.
 * The result is injected as the shell's importmap.
 * `ohnejs/utils` serves the full utils barrel.
 * A dashboard page or layer can import any isomorphic util by name.
 */
const IMPORTMAP = jsonForScript({
  imports: {
    'ohnejs/dashboard': `${MODULE_BASE}/dashboard/index.ts`,
    'ohnejs/utils': `${MODULE_BASE}/utils/index.ts`,
    'app/': `${APP_MODULE_BASE}/`,
  },
});

/**
 * The favicon: the ohne mark at rest, the solid dot, as an inline SVG data URI.
 * The fills are the foundation's foreground colours, light and dark, so the tab icon matches the UI.
 */
const FAVICON = `data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 48 48'><style>circle{fill:%23260d1c}@media(prefers-color-scheme:dark){circle{fill:%23fafafa}}</style><circle cx='24' cy='24' r='18'/></svg>`;

/**
 * The background the shell paints before the kernel's stylesheets load, copied from `--ohne-background`.
 * No stylesheet sets `color-scheme` later, so this is the document's only one.
 */
const CANVAS = `
      :root { color-scheme: light; background: hsl(210 22.2% 96.5%) }
      .dark { color-scheme: dark; background: hsl(234 16.7% 11.8%) }
    `;

/**
 * The framework subtrees the browser graph may load: the dashboard kernel and the utils it imports.
 * Everything else under `src` (the Node framework internals) is off-limits to the browser.
 */
const MODULE_ROOTS = ['dashboard', 'utils'].map((dir) => resolvePath(dir, SRC_ROOT));

/**
 * Boots the dashboard server for the project rooted at `from` and starts serving it.
 *
 * Resolves the layer stack, then serves a single-page shell on every navigation.
 * The shell injects the page manifest and the boot file URLs, both scanned per request, plus an importmap.
 * It then boots the client kernel, which runs every boot file before the router starts.
 * The framework kernel is served under `/m/`, each layer's dashboard modules under `/m/app/`.
 * Both are type-stripped to JavaScript: the dashboard is a pure SPA with no build step.
 *
 * Port and host come from `Config.dashboard`, overridden by the `PORT` and `HOST` env vars when set.
 * The injected API base URL comes from the `API_URL` env, then `Config.dashboard.apiURL`, then `Config.api`.
 * The `.env` at `from` fills the environment first, so every config file sees it.
 * The app root is the nearest `package.json` above `from`.
 * The listening socket and the shutdown funnel keep the process alive after this resolves.
 */
export async function serveDashboard(from: string = process.cwd()): Promise<HTTPServer> {
  await loadProjectEnv(from);
  await loadLayers(from);
  const config = useConfig().dashboard;

  const layers = stackedLayers();
  const appRoots = dashboardRoots(layers);
  const app = last(layers);
  if (!isUndefined(app)) await warnMissingTSConfig(appRoots[0], app.dir);
  const apiURL = resolveAPIURL();
  const defaultLanguage = resolveDefaultLanguage();
  const reload = useEnv().get('DASHBOARD_RELOAD');

  const renderShell = async (): Promise<string> =>
    shellDocument(
      apiURL,
      buildDashboardPageManifest(await collectDashboardPages(layers), APP_MODULE_BASE),
      (await collectDashboardBoot(layers)).map((boot) => `${APP_MODULE_BASE}/${boot.module}`),
      defaultLanguage,
      reload,
    );

  const routes: Route[] = [
    synthetic('/', renderShell),
    synthetic('/[...path]', renderShell),
    synthetic(`${APP_MODULE_BASE}/[...path]`, ({ params }: HandlerContext) =>
      sendFile(appRoots, params.path, { notFound: 'Not Found' }),
    ),
    synthetic(`${ICON_BASE}/[name]`, serveIcon),
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

/**
 * A `GET` route the dashboard server registers itself, with no backing file or layer.
 */
function synthetic(pattern: string, handler: Route['handler']): Route {
  return { method: 'GET', pattern, file: '', layer: '', handler };
}

/**
 * Serves one vendored shape as the markup that goes inside an `svg` element.
 *
 * The body is looked up by name in the shape table, never anything the request supplied.
 * `text/plain` is both honest and the safest type to hand back from the dashboard's own origin.
 * An unknown name is a `404`, which the browser caches as "no shape" and stops asking for.
 */
function serveIcon({ params }: HandlerContext): string | undefined {
  const shape = iconShape(params.name);
  if (isUndefined(shape)) throw notFound('Not Found');

  const response = useResponse();
  response.headers.set('content-type', 'text/plain; charset=utf-8');
  response.headers.set('etag', etag(shape));
  response.headers.set(
    'cache-control',
    cacheControl({ public: true, maxAge: ICON_MAX_AGE, immutable: true }),
  );

  if (isFresh()) {
    sendNotModified();
    return undefined;
  }
  return shape;
}

/**
 * Serves one framework kernel module from `src`, type-stripped.
 * Only the dashboard and utils subtrees are reachable; any other path, escaped or not, is a `404`.
 */
function serveModule({ params }: HandlerContext): Promise<string | Uint8Array | undefined> {
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

/**
 * The API base URL the browser calls: `API_URL`, else `dashboard.apiURL`, else derived from `api`.
 */
function resolveAPIURL(): string {
  const api = useConfig().api;
  const host = useEnv().get('HOST') ?? api.host ?? 'localhost';
  return (
    useEnv().get('API_URL') ??
    useConfig().dashboard?.apiURL ??
    `http://${host}:${api.port ?? DEFAULT_API_PORT}${normalizeBasePath(api.basePath)}`
  );
}

/**
 * Warns when the app's dashboard directory exists without a `tsconfig.json`, printing the one to create.
 * It only extends the generated browser bucket config, which carries the `app/*` paths and the includes.
 * The `extends` path is relative to the dashboard directory, so a nested `dirs.dashboard` still resolves.
 */
async function warnMissingTSConfig(dashboardDir: string, appDir: string): Promise<void> {
  if (!(await exists(dashboardDir))) return;
  if (await exists(joinPath(dashboardDir, 'tsconfig.json'))) return;

  const codegen = await codegenDir(appDir);
  if (isNull(codegen)) return;

  const base = relativePath(dashboardDir, joinPath(codegen, 'browser/tsconfig.json'));
  usePrinter().warnBlock({
    title: 'Dashboard has no `tsconfig.json`',
    body: [
      'Without it the editor lacks DOM types and the generated types for dashboard code.',
      'Create a `tsconfig.json` inside it with:',
      `{\n  "extends": ${JSON.stringify(base)}\n}`,
    ],
    path: relativePath(process.cwd(), dashboardDir),
  });
}

/**
 * The canonical form of `messages.defaultLanguage`; an invalid tag fails the boot.
 */
function resolveDefaultLanguage(): string {
  const configured = useConfig().messages.defaultLanguage;
  const canonical = canonicalizeLanguage(configured);
  if (isNull(canonical)) {
    throw ohneError({
      title: `Invalid default language \`${configured}\``,
      body: ['Set `messages.defaultLanguage` to a valid BCP-47 tag, like `en` or `de-AT`.'],
    });
  }
  return canonical;
}

/**
 * The single-page shell: the pre-paint color-mode script, the config, the importmap, and the kernel.
 */
function shellDocument(
  apiURL: string,
  pages: PageRoute[],
  boot: string[],
  defaultLanguage: string,
  reload: boolean,
): string {
  const config = jsonForScript({ apiURL, pages, boot, defaultLanguage });
  const reloadClient = reload
    ? `\n    <script type="module" src="${MODULE_BASE}/dashboard/runtime/reload-client.ts"></script>`
    : '';
  return `<!doctype html>
<html lang="${defaultLanguage}">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>ohne</title>
    <link rel="icon" type="image/svg+xml" href="${FAVICON}" />
    <script>
      try {
        var mode = localStorage.getItem('ohne-color-mode');
        var dark =
          mode === 'dark' ||
          (mode !== 'light' && matchMedia('(prefers-color-scheme: dark)').matches);
        document.documentElement.classList.add(dark ? 'dark' : 'light');
      } catch {}
    </script>
    <style>${CANVAS}</style>
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
