import type { MessageMeta } from '../messages/messages.ts';
import type { HandlerContext, Route } from '../routes/route.ts';

import { etag } from '../../utils/etag/etag.ts';
import { exists } from '../../utils/fs/index.ts';
import { createImportMapResolver } from '../../utils/imports/create-import-map-resolver.ts';
import {
  cacheControl,
  canonicalizeLanguage,
  escapeXML,
  formatMessage,
  isEmpty,
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
  resolveCatalog,
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
import {
  createModuleTable,
  type ModuleMount,
  type ModuleTable,
  isFingerprinted,
  type ScannedModule,
} from './_module-table.ts';

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
 * URL prefix the dashboard server answers a group's fallback messages under, as `/m/messages/<group>`.
 * `src/dashboard/runtime/messages.ts` resolves it against its own served URL, so the two cannot drift.
 */
const MESSAGES_BASE = `${MODULE_BASE}/messages`;

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
 * The tab's mark that the dashboard already reloaded itself over a failed load.
 * The kernel's router sets the same key, so a failed boot and a failed page share one reload.
 */
const RELOADED = 'ohne-reloaded';

/**
 * The kernel's entry module, the one the shell loads.
 */
const KERNEL_ENTRY = `${MODULE_BASE}/dashboard/boot.ts`;

/**
 * The dev live-reload client the shell loads under `DASHBOARD_RELOAD`.
 */
const RELOAD_CLIENT = `${MODULE_BASE}/dashboard/runtime/reload-client.ts`;

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
const KERNEL_MOUNTS: ModuleMount[] = ['dashboard', 'utils'].map((dir) => ({
  base: `${MODULE_BASE}/${dir}`,
  roots: [resolvePath(dir, SRC_ROOT)],
}));

/**
 * Boots the dashboard server for the project rooted at `from` and starts serving it.
 *
 * Resolves the layer stack, then serves a single-page shell on every navigation.
 * The shell injects the page manifest and the boot file URLs, both scanned per request, plus an importmap.
 * It then boots the client kernel, which runs every boot file before the router starts.
 * The framework kernel is served under `/m/`, each layer's dashboard modules under `/m/app/`.
 * Both are type-stripped to JavaScript: the dashboard is a pure SPA with no build step.
 *
 * The importmap names every module by a fingerprint of its bytes, so the browser keeps each one for good.
 * The shell also preloads every module the kernel, the boot files and the pages reach, all at once.
 * Every shell render rescans the modules first, so the page never names bytes that are gone.
 * The shell itself is revalidated on every load.
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
  const modules = createModuleTable([...KERNEL_MOUNTS, { base: APP_MODULE_BASE, roots: appRoots }]);
  await modules.scan();

  // A framed dashboard could be clickjacked into a save or a delete; only listed pages may frame it.
  const renderShell = async (): Promise<string | undefined> => {
    const response = useResponse();
    response.headers.set('content-security-policy', framing);
    response.headers.set('cache-control', cacheControl({ noCache: true }));
    const scanned = await modules.scan();
    const messages = await collectMessages(layers, { disable: useConfig().disable.messages });
    const pages = buildDashboardPageManifest(await collectDashboardPages(layers), APP_MODULE_BASE);
    const boot = (await collectDashboardBoot(layers)).map(
      (file) => `${APP_MODULE_BASE}/${file.module}`,
    );
    const imports = importMap(scanned);
    const entries = reload ? [KERNEL_ENTRY, RELOAD_CLIENT] : [KERNEL_ENTRY];
    const html = shellDocument(
      apiURL,
      pages,
      boot,
      defaultLanguage,
      uniqueArray(messages.map((message) => messageGroup(message.key))),
      bootFailed(messages, defaultLanguage, failedIcon),
      reload,
      imports,
      preloads([...entries, ...boot, ...pages.map((page) => page.url)], imports, scanned),
    );
    response.headers.set('etag', etag(html));

    if (isFresh()) {
      sendNotModified();
      return undefined;
    }
    return html;
  };

  const routes: Route[] = [
    synthetic('/', renderShell),
    synthetic('/[...path]', renderShell),
    synthetic(`${APP_MODULE_BASE}/[...path]`, ({ params }: HandlerContext) =>
      serveFrom(modules, appRoots, params.path),
    ),
    synthetic(`${ICON_BASE}/[name]`, serveIcon),
    synthetic(`${MESSAGES_BASE}/[group]`, async ({ params }: HandlerContext) => {
      const messages = await collectMessages(layers, { disable: useConfig().disable.messages });
      return fallbackCatalog(messages, params.group, defaultLanguage);
    }),
    synthetic(`${MODULE_BASE}/[...path]`, ({ params }: HandlerContext) =>
      serveModule(modules, params.path),
    ),
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
 * Serves one group's messages in the default language, for a dashboard whose API cannot answer them.
 * A group no catalog defines is a `404`.
 */
function fallbackCatalog(
  messages: MessageMeta[],
  group: string,
  defaultLanguage: string,
): Record<string, { template: string; language: string }> {
  const catalogs: Record<string, Record<string, string>> = {};
  for (const { language, key, template } of messages) (catalogs[language] ??= {})[key] = template;
  const catalog = resolveCatalog(catalogs, group, defaultLanguage, defaultLanguage);
  if (isEmpty(catalog)) throw notFound('Not Found');
  useResponse().headers.set('cache-control', cacheControl({ noCache: true }));
  return catalog;
}

/**
 * Serves one framework kernel file from `src`, a module type-stripped.
 * Only the dashboard and utils subtrees are reachable; any other path, escaped or not, is a `404`.
 */
function serveModule(modules: ModuleTable, path: string): Promise<string | Uint8Array | undefined> {
  const resolved = safeResolve(SRC_ROOT, path);
  const roots = KERNEL_MOUNTS.flatMap((mount) => mount.roots);
  if (isNull(resolved) || !roots.some((root) => isPathInside(resolved, root))) {
    throw notFound('Not Found');
  }
  return serveFrom(modules, [SRC_ROOT], path);
}

/**
 * Serves `path` from the first of `roots`: a module or a font through the module table, any other file as is.
 * Other assets stay out of the table, so a large file a layer ships never sits in memory.
 */
function serveFrom(
  modules: ModuleTable,
  roots: string[],
  path: string,
): Promise<string | Uint8Array | undefined> {
  return isFingerprinted(path)
    ? modules.send(roots, path)
    : sendFile(roots, path, { notFound: 'Not Found' });
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
 * The importmap's `imports`, naming every module in `scanned` by its fingerprinted URL.
 * A mapped specifier is never mapped again, so each bare name points straight at a fingerprinted URL.
 * Each layer module gets its own `app/` name too, so a bare and a relative import load one instance.
 * The `app/` prefix stays for a module the scan left out, which loads from its plain URL either way.
 */
function importMap(scanned: Map<string, ScannedModule>): Record<string, string> {
  const kernel = `${MODULE_BASE}/dashboard/index.ts`;
  const utils = `${MODULE_BASE}/utils/index.ts`;
  const imports: Record<string, string> = {
    'ohnejs/dashboard': scanned.get(kernel)?.hashed ?? kernel,
    'ohnejs/utils': scanned.get(utils)?.hashed ?? utils,
    'app/': `${APP_MODULE_BASE}/`,
  };
  for (const [url, { hashed }] of scanned) {
    if (url.startsWith(`${APP_MODULE_BASE}/`)) {
      imports[`app/${url.slice(APP_MODULE_BASE.length + 1)}`] = hashed;
    }
    imports[url] = hashed;
  }
  return imports;
}

/**
 * The fingerprinted URL of every module `roots` reach through `imports`, breadth-first from the roots.
 * The browser preloads a module without its imports, so the list carries the whole graph.
 * Each specifier resolves as the browser resolves it, and one that names no scanned module is skipped.
 */
function preloads(
  roots: string[],
  imports: Record<string, string>,
  scanned: Map<string, ScannedModule>,
): string[] {
  const resolve = createImportMapResolver(imports);
  const modules = new Map<string, [url: string, module: ScannedModule]>();
  for (const [url, module] of scanned) {
    const target = resolve(url, '/');
    if (!isNull(target)) modules.set(target, [url, module]);
  }

  const found = new Map<string, [url: string, module: ScannedModule]>();
  const visit = (specifier: string, base: string): void => {
    const target = resolve(specifier, base) ?? '';
    const module = modules.get(target);
    if (!isUndefined(module)) found.set(target, module);
  };
  for (const root of roots) visit(root, '/');
  for (const [url, module] of found.values()) {
    for (const specifier of module.imports) visit(specifier, url);
  }
  return [...found.keys()];
}

/**
 * The single-page shell: the pre-paint color-mode script, the config, the importmap, and the kernel.
 * A module script's `src` and a preload's `href` skip the importmap, so the shell writes fingerprinted URLs.
 * The preloads follow the importmap, since a browser ignores an importmap that comes after a module fetch.
 * Until the kernel announces `ohne-booted`, a failure to load or run it reloads the page once.
 * A failure after that reload swaps `#app` for `failed`, so a dropped request never leaves a blank page.
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
  imports: Record<string, string>,
  preload: string[],
): string {
  const config = jsonForScript({ apiURL, pages, boot, defaultLanguage, messageGroups });
  const links = preload
    .map((href) => `\n    <link rel="modulepreload" href="${escapeXML(href)}" />`)
    .join('');
  const reloadClient = reload
    ? `\n    <script type="module" src="${imports[RELOAD_CLIENT] ?? RELOAD_CLIENT}"></script>`
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
    <script type="importmap">${jsonForScript({ imports })}</script>${links}
  </head>
  <body>
    <div id="app"></div>
    ${failed}
    <script type="application/json" id="ohne-config">${config}</script>
    <script type="module" src="${imports[KERNEL_ENTRY] ?? KERNEL_ENTRY}" id="ohne-boot"></script>
    <script>
      {
        const kernel = document.getElementById('ohne-boot');
        const fail = (event) => {
          if (event.target !== window && event.target !== kernel) return;
          removeEventListener('error', fail, true);
          try {
            if (sessionStorage.getItem('${RELOADED}') === null) {
              sessionStorage.setItem('${RELOADED}', '1');
              return location.reload();
            }
          } catch {}
          const failed = document.getElementById('ohne-boot-failed').content.cloneNode(true);
          failed.querySelector('button').addEventListener('click', () => location.reload());
          document.getElementById('app').replaceChildren(failed);
        };
        addEventListener('error', fail, true);
        const booted = () => {
          removeEventListener('error', fail, true);
          try {
            sessionStorage.removeItem('${RELOADED}');
          } catch {}
        };
        addEventListener('ohne-booted', booted, { once: true });
      }
    </script>${reloadClient}
  </body>
</html>
`;
}
