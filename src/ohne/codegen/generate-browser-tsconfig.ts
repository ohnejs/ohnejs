import {
  type CodeBuilder,
  createCodeBuilder,
  createCodeGenerator,
} from '../../utils/codegen/index.ts';
import { first, isNull, isUndefined, relativePath } from '../../utils/index.ts';
import { dashboardRoots } from '../dashboard/dashboard-roots.ts';
import { stackedLayers } from '../layers/stacked-layers.ts';
import { BANNER, codegenBucket } from './codegen-dir.ts';

/**
 * Generates `browser/tsconfig.json`, the base of the app's browser type program.
 *
 * The app's `dashboard/tsconfig.json` extends it and needs nothing else.
 * It extends `ohnejs/tsconfig.browser.json` by package name, as the scaffold's root tsconfig does.
 * `paths` maps `app/*` onto every stacked layer's dashboard directory, closest first, as the server serves it.
 * `include` covers the app's dashboard directory and the two buckets the browser program loads.
 * An editor assigns an open file to the nearest ancestor `tsconfig.json` that includes it.
 * The bucket's own files sit beside this one, so that walk finds it instead of an inferred project.
 * Layers come from the registered stack, so `loadLayers` must have run first.
 *
 * The app root is the nearest `package.json` above `from` (default `process.cwd()`).
 * The file is rewritten only when its contents change.
 * Returns the absolute path written, or `null` when no `package.json` is found.
 */
export async function generateBrowserTSConfig(
  from: string = process.cwd(),
): Promise<string | null> {
  const dir = await codegenBucket(from, 'browser');
  if (isNull(dir)) return null;

  const roots = dashboardRoots(stackedLayers()).map((root) => relativePath(dir, root));
  const own = first(roots);
  const include = isUndefined(own) ? [] : [`${own}/**/*.ts`];
  include.push('../shared/**/*.ts', './**/*.ts');

  const code = createCodeBuilder();
  code.line('{');
  code.indent(() => {
    code.line('"extends": "ohnejs/tsconfig.browser.json",');
    code.line('"compilerOptions": {');
    code.indent(() => {
      code.line('"paths": {');
      code.indent(() => {
        emitList(
          code,
          '"app/*": ',
          roots.map((root) => `${root}/*`),
        );
      });
      code.line('}');
    });
    code.line('},');
    emitList(code, '"include": ', include);
  });
  code.line('}');
  return write(dir, code);
}

/**
 * Emits `head[`, one quoted item per line, then `]`.
 */
function emitList(code: CodeBuilder, head: string, items: readonly string[]): void {
  code.line(`${head}[`);
  code.indent(() => {
    items.forEach((item, i) => {
      code.line(`${JSON.stringify(item)}${i < items.length - 1 ? ',' : ''}`);
    });
  });
  code.line(']');
}

/**
 * Writes `tsconfig.json` into `dir` when its contents changed, returning its absolute path either way.
 */
async function write(dir: string, code: CodeBuilder): Promise<string> {
  const gen = createCodeGenerator({ dir, banner: BANNER });
  await gen.write('tsconfig.json', code.toString());
  return gen.path('tsconfig.json');
}
