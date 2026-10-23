import type { MessageMeta } from '../messages/messages.ts';
import type { HandlerContext, Route } from '../routes/route.ts';

import { etag } from '../../utils/etag/etag.ts';
import { exists } from '../../utils/fs/index.ts';
import {
  cacheControl,
  canonicalizeLanguage,
  escapeXML,
  formatMessage,
  isNull,
  isPathInside,
  isPort,
  isUndefined,
  joinPath,
  jsonForScript,
  languageFallbacks,
  last,
  MAX_PORT,
  messageGroup,
  normalizeBasePath,
  type PageRoute,
  relativePath,
  resolvePath,
  safeResolve,
  uniqueArray,
} from '../../utils/index.ts';
import { listenOrigin } from '../../utils/net/index.ts';
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
import { collectMessages } from '../messages/collect-messages.ts';
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
 * The look of the boot failure: the kit's `errorState` centered on the page, its retry an outline button.
 * The kernel's stylesheets may never have loaded, so the colors are the foundation's, copied as in `CANVAS`.
 */
const BOOT_FAILED_STYLE = `
        .ohne-boot-failed {
          position: fixed;
          inset: 0;
          display: flex;
          flex-direction: column;
          gap: 0.5em;
          justify-content: center;
          align-items: center;
          padding: 1.5em 0.75em;
          color: hsl(228 11% 44%);
          font: 1rem/1.5 'Inter', sans-serif;
          text-align: center;
        }
        .ohne-boot-failed svg { font-size: 2.5em; opacity: 0.5 }
        .ohne-boot-failed [stroke] { stroke-width: 1.5 }
        .ohne-boot-failed p { max-width: 32em; margin: 0; font-size: 0.875rem }
        .ohne-boot-failed button {
          height: 2.25em;
          margin-top: 0.25em;
          padding: 0 0.75em;
          border: 1px solid hsl(210 7.41% 89.4%);
          border-radius: 0.375rem;
          background: hsl(210 22.2% 96.5%);
          color: hsl(324 49% 10%);
          font: inherit;
          font-size: 0.875rem;
          font-weight: 500;
          cursor: pointer;
        }
        .dark .ohne-boot-failed { color: hsl(228 11% 65%) }
        .dark .ohne-boot-failed button {
          border-color: hsl(231 16.7% 32%);
          background: hsl(234 16.7% 11.8%);
          color: hsl(0 0% 98%);
        }
        @media (hover: hover) {
          .ohne-boot-failed button:hover {
            border-color: hsl(209 71% 88%);
            background: hsl(209 71% 88%);
            color: hsl(324 49% 10%);
          }
          .dark .ohne-boot-failed button:hover {
            border-color: hsl(208 52% 28%);
            background: hsl(208 52% 28%);
            color: hsl(0 0% 98%);
          }
        }
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
  const framing = `frame-ancestors ${config?.frameAncestors?.join(' ') || "'none'"}`;
  const failedIcon = iconShape('cloud-off') ?? '';

  // A framed dashboard could be clickjacked into a save or a delete; only listed pages may frame it.
  const renderShell = async (): Promise<string> => {
    useResponse().headers.set('content-security-policy', framing);
    const messages = await collectMessages(layers, { disable: useConfig().disable.messages });
    return shellDocument(
      apiURL,
      buildDashboardPageManifest(await collectDashboardPages(layers), APP_MODULE_BASE),
      (await collectDashboardBoot(layers)).map((boot) => `${APP_MODULE_BASE}/${boot.module}`),
      defaultLanguage,
      uniqueArray(messages.map((message) => messageGroup(message.key))),
      bootFailed(messages, defaultLanguage, failedIcon),
      reload,
    );
  };

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

  usePrinter().success(`Dashboard ready at \`${listenOrigin(host, address.port)}\``);
  if (process.connected) process.send?.('ready');
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
  const origin = listenOrigin(useEnv().get('HOST') ?? api.host, api.port ?? DEFAULT_API_PORT);
  return (
    useEnv().get('API_URL') ??
    useConfig().dashboard?.apiURL ??
    `${origin}${normalizeBasePath(api.basePath)}`
  );
}

/**
 * Warns when the app's dashboard directory exists without a `tsconfig.json`.
 * It prints the file to create and the `typecheck` command that checks it.
 * The file only extends the generated browser bucket config, which carries the `app/*` paths and includes.
 * The `extends` path is relative to the dashboard directory, so a nested `dirs.dashboard` still resolves.
 * The command's path is relative to the app directory, where `package.json` scripts run.
 */
async function warnMissingTSConfig(dashboardDir: string, appDir: string): Promise<void> {
  if (!(await exists(dashboardDir))) return;
  if (await exists(joinPath(dashboardDir, 'tsconfig.json'))) return;

  const codegen = await codegenDir(appDir);
  if (isNull(codegen)) return;

  const base = relativePath(dashboardDir, joinPath(codegen, 'browser/tsconfig.json'));
  const program = relativePath(appDir, joinPath(dashboardDir, 'tsconfig.json'));
  usePrinter().warnBlock({
    title: 'Dashboard has no `tsconfig.json`',
    body: [
      'Without it the editor lacks DOM types and the generated types for dashboard code.',
      'Create a `tsconfig.json` inside it with:',
      `{\n  "extends": ${JSON.stringify(base)}\n}`,
      `Then add its check to the \`typecheck\` script in \`package.json\`: \`tsc && tsc -p ${program}\`.`,
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
 * The state the shell falls back to when the dashboard fails to boot, as an inert `template`.
 * Its text is translated into `language` from `messages`, so it reads as the kit's `errorState` would.
 */
function bootFailed(messages: MessageMeta[], language: string, icon: string): string {
  const text = escapeXML(bootText(messages, language, 'dashboard.loadFailed', 'Failed to load'));
  const retry = escapeXML(bootText(messages, language, 'dashboard.retry', 'Retry'));
  return `<template id="ohne-boot-failed">
      <style>${BOOT_FAILED_STYLE}</style>
      <div class="ohne-boot-failed" role="alert">
        <svg viewBox="0 0 24 24" width="1em" height="1em" aria-hidden="true">${icon}</svg>
        <p>${text}</p>
        <button type="button" class="ohne-raw">${retry}</button>
      </div>
    </template>`;
}

/**
 * Translates `key` into `language` from `messages`, down the language's fallback chain.
 * With no catalog defining it, the English `fallback` stands, as the kit's `defaultText` does.
 */
function bootText(
  messages: MessageMeta[],
  language: string,
  key: string,
  fallback: string,
): string {
  for (const tag of languageFallbacks(language)) {
    const found = messages.find((message) => message.language === tag && message.key === key);
    if (!isUndefined(found)) return formatMessage(found.template, undefined, tag);
  }
  return fallback;
}

/**
 * The single-page shell: the pre-paint color-mode script, the config, the importmap, and the kernel.
 * Until the kernel announces `ohne-booted`, a failure to load or run it swaps `#app` for `failed`.
 * That covers a module the browser could not fetch, so a dropped request never leaves a blank page.
 * The guard listens while capturing, since a script's fetch failure does not bubble.
 */
function shellDocument(
  apiURL: string,
  pages: PageRoute[],
  boot: string[],
  defaultLanguage: string,
  messageGroups: string[],
  failed: string,
  reload: boolean,
): string {
  const config = jsonForScript({ apiURL, pages, boot, defaultLanguage, messageGroups });
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
    ${failed}
    <script type="application/json" id="ohne-config">${config}</script>
    <script type="module" src="${MODULE_BASE}/dashboard/boot.ts" id="ohne-boot"></script>
    <script>
      {
        const kernel = document.getElementById('ohne-boot');
        const fail = (event) => {
          if (event.target !== window && event.target !== kernel) return;
          removeEventListener('error', fail, true);
          const failed = document.getElementById('ohne-boot-failed').content.cloneNode(true);
          failed.querySelector('button').addEventListener('click', () => location.reload());
          document.getElementById('app').replaceChildren(failed);
        };
        addEventListener('error', fail, true);
        addEventListener('ohne-booted', () => removeEventListener('error', fail, true), { once: true });
      }
    </script>${reloadClient}
  </body>
</html>
`;
}
