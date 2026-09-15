import {
  type CodeBuilder,
  createCodeBuilder,
  createCodeGenerator,
  importSpecifier,
  literalString,
  propertyKey,
} from '../../utils/codegen/index.ts';
import { isNull, joinPath } from '../../utils/index.ts';
import { stackedLayers } from '../layers/stacked-layers.ts';
import { useConfig } from '../layers/use-config.ts';
import { collectRoutes } from '../routes/collect-routes.ts';
import { type RouteMeta, routeID } from '../routes/route.ts';
import { BANNER, codegenDir } from './codegen-dir.ts';

/**
 * Generates the route table from every layer's API directory.
 *
 * Emits one file per codegen bucket, so the server and dashboard share a single source of truth.
 * `shared/routes.ts` types every route id as `GeneratedAPIRoutes`.
 * `node/routes.ts` augments `ohnejs`'s `KnownRoutes` with handler types and registers each route.
 * `browser/routes.ts` augments `ohnejs/dashboard`, so `api` can suggest the known route ids.
 * Each handler is statically imported from its source file by relative path.
 *
 * Routes are read from each layer's `Config.dirs.api` directory and combined.
 * Layers come from the registered stack, so `loadLayers` must have run first.
 * A closer layer overrides an earlier route with the same id.
 * Routes matched by `Config.disable.routes` are then dropped.
 *
 * The app root is the nearest `package.json` above `from` (default `process.cwd()`).
 * Output lands in the app's own `dirs.codegen` (default `.ohne`), resolved against that root.
 *
 * Each file is rewritten only when its contents change.
 * Returns the absolute paths written, empty when no `package.json` is found.
 */
export async function generateRoutes(from: string = process.cwd()): Promise<string[]> {
  const dir = await codegenDir(from);
  if (isNull(dir)) return [];

  const routes = await collectRoutes(stackedLayers(), {
    disable: useConfig().disable.routes,
  });

  return Promise.all([
    writeShared(joinPath(dir, 'shared'), routes),
    writeNode(joinPath(dir, 'node'), routes),
    writeBrowser(joinPath(dir, 'browser')),
  ]);
}

/**
 * Writes `shared/routes.ts`: the pure `GeneratedAPIRoutes` type, one member per route id.
 * It holds no runtime and references no module, so both the node and browser programs include it.
 */
async function writeShared(dir: string, routes: readonly RouteMeta[]): Promise<string> {
  const code = createCodeBuilder();
  emitInterface(
    code,
    'export interface GeneratedAPIRoutes',
    routes.map((route) => `${propertyKey(routeID(route.method, route.pattern))}: true;`),
  );
  return write(dir, code);
}

/**
 * Writes `node/routes.ts`: augments `ohnejs`'s `KnownRoutes` with handler types, registers each route.
 */
async function writeNode(dir: string, routes: readonly RouteMeta[]): Promise<string> {
  const code = createCodeBuilder();
  code.line(
    routes.length === 0 ? "import type {} from 'ohnejs';" : "import { useRoutes } from 'ohnejs';",
  );
  routes.forEach((route, i) => {
    code.line(`import h${i} from ${literalString(importSpecifier(dir, route.file))};`);
  });
  code.line();

  code.line("declare module 'ohnejs' {");
  code.indent(() => {
    emitInterface(
      code,
      'interface KnownRoutes',
      routes.map(
        (route, i) => `${propertyKey(routeID(route.method, route.pattern))}: typeof h${i};`,
      ),
    );
  });
  code.line('}');

  if (routes.length > 0) {
    code.line();
    code.line('const routes = useRoutes();');
    routes.forEach((route, i) => {
      code.line();
      code.line(`routes.register(${literalString(routeID(route.method, route.pattern))}, {`);
      code.indent(() => {
        code.line(`method: ${isNull(route.method) ? 'null' : literalString(route.method)},`);
        code.line(`pattern: ${literalString(route.pattern)},`);
        code.line(`file: ${literalString(route.file)},`);
        code.line(`layer: ${literalString(route.layer)},`);
        code.line(`handler: h${i},`);
      });
      code.line('});');
    });
  }
  return write(dir, code);
}

/**
 * Writes `browser/routes.ts`: augments `ohnejs/dashboard` so `api` narrows its route id to the known set.
 * Its shape is constant; it only wires the shared type onto the browser's interface.
 */
async function writeBrowser(dir: string): Promise<string> {
  const code = createCodeBuilder();
  code.line("import type {} from 'ohnejs/dashboard';");
  code.line("import type { GeneratedAPIRoutes } from '../shared/routes.ts';");
  code.line();
  code.line("declare module 'ohnejs/dashboard' {");
  code.indent(() => {
    code.line('interface KnownAPIRoutes extends GeneratedAPIRoutes {}');
  });
  code.line('}');
  return write(dir, code);
}

/**
 * Writes `routes.ts` into `dir` when its contents changed, returning its absolute path either way.
 */
async function write(dir: string, code: CodeBuilder): Promise<string> {
  const gen = createCodeGenerator({ dir, banner: BANNER });
  await gen.write('routes.ts', code.toString());
  return gen.path('routes.ts');
}

/**
 * Emits `head { ... }`, collapsing to `head {}` when there are no members.
 */
function emitInterface(code: CodeBuilder, head: string, members: string[]): void {
  if (members.length === 0) {
    code.line(`${head} {}`);
    return;
  }
  code.line(`${head} {`);
  code.indent(() => code.lines(members));
  code.line('}');
}
