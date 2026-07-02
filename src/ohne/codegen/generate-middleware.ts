import {
  createCodeBuilder,
  createCodeGenerator,
  importSpecifier,
  literalString,
  propertyKey,
} from '../../utils/codegen/index.ts';
import { isNull } from '../../utils/index.ts';
import { collectMiddleware } from '../middleware/collect-middleware.ts';
import { resolveOhneLayers } from '../project/resolve-ohne-layers.ts';
import { BANNER, codegenBucket } from './codegen-dir.ts';

/**
 * Generates the middleware table from every layer's middleware directory.
 * Emits `node/middleware.ts` so importing it registers each middleware into `useMiddleware`, in run order.
 * Global middleware register through `registerGlobal`; named ones through `register`.
 * It types `KnownMiddleware` with every name, so `MiddlewareKey` is the union of all of them.
 * It types `KnownNamedMiddleware` with the named ones, so `NamedMiddlewareKey` is what a route selects.
 * Each middleware is statically imported from its source file by relative path.
 *
 * Middleware is read from each layer's `Config.dirs.middleware` directory and combined.
 * A closer layer overrides an earlier middleware with the same resolved name.
 *
 * The app root is the nearest `package.json` above `from` (default `process.cwd()`).
 * Output lands in the `node` bucket of the app's `dirs.codegen` (default `.ohne`).
 *
 * The file is rewritten only when its contents change.
 * Returns the absolute path written, or `null` when no `package.json` is found.
 */
export async function generateMiddleware(from: string = process.cwd()): Promise<string | null> {
  const dir = await codegenBucket(from, 'node');
  if (isNull(dir)) return null;

  const middleware = await collectMiddleware(await resolveOhneLayers(from));
  const indexed = middleware.map((entry, index) => ({ ...entry, index }));
  const named = indexed.filter((entry) => !entry.isGlobal);

  const code = createCodeBuilder();
  code.line(
    middleware.length === 0
      ? "import type {} from 'ohne';"
      : "import { useMiddleware } from 'ohne';",
  );
  indexed.forEach((entry) => {
    code.line(`import m${entry.index} from ${literalString(importSpecifier(dir, entry.file))};`);
  });
  code.line();

  const known = (label: string, entries: typeof indexed): void => {
    if (entries.length === 0) {
      code.line(`interface ${label} {}`);
      return;
    }
    code.line(`interface ${label} {`);
    code.indent(() => {
      entries.forEach((entry) => code.line(`${propertyKey(entry.name)}: typeof m${entry.index};`));
    });
    code.line('}');
  };

  code.line("declare module 'ohne' {");
  code.indent(() => {
    known('KnownMiddleware', indexed);
    known('KnownNamedMiddleware', named);
  });
  code.line('}');

  if (middleware.length > 0) {
    code.line();
    code.line('const middleware = useMiddleware();');
    indexed.forEach((entry) => {
      const method = entry.isGlobal ? 'registerGlobal' : 'register';
      code.line(`middleware.${method}(${literalString(entry.name)}, m${entry.index});`);
    });
  }

  const gen = createCodeGenerator({ dir, banner: BANNER });
  await gen.write('middleware.ts', code.toString());
  return gen.path('middleware.ts');
}
