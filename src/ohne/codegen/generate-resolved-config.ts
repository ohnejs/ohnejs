import {
  type CodeBuilder,
  createCodeBuilder,
  createCodeGenerator,
  propertyKey,
} from '../../utils/codegen/index.ts';
import {
  dotUnset,
  isEmpty,
  isNull,
  isPlainObject,
  type LayerStrategies,
  merge,
} from '../../utils/index.ts';
import { useLayers } from '../layers/use-layers.ts';
import { BANNER, codegenBucket } from './codegen-dir.ts';

/**
 * Emits each defaulted key as `true`, nesting into plain objects, so the type mirrors the defaults' shape.
 * It never nests into a `'replace'` path or an `'assign'` path's entries.
 */
function writeDefaults(
  code: CodeBuilder,
  defaults: Record<string, unknown>,
  strategies: LayerStrategies,
  parent = '',
): void {
  for (const [name, value] of Object.entries(defaults)) {
    const path = parent === '' ? name : `${parent}.${name}`;
    const whole = strategies[path] === 'replace' || strategies[parent] === 'assign';
    if (isPlainObject(value) && !whole) {
      code.line(`${propertyKey(name)}: {`);
      code.indent(() => writeDefaults(code, value, strategies, path));
      code.line('};');
    } else {
      code.line(`${propertyKey(name)}: true;`);
    }
  }
}

/**
 * Generates the `ResolvedConfig` type from the layers' merged defaults.
 * Emits `node/resolved-config.ts` so `ResolvedConfig` makes every defaulted field required, keeping its type.
 * A field set only by a runtime `input` stays optional; only a default makes it required.
 * A key marked `'own'` stays optional too, since no default ever reaches it.
 * A key marked `'replace'` is required but its fields are not, since a closer value replaces it whole.
 * So is each entry of a key marked `'assign'`.
 *
 * The app root is the nearest `package.json` above `from` (default `process.cwd()`).
 * Output lands in the `node` bucket of the app's `dirs.codegen` (default `.ohne`).
 *
 * The file is rewritten only when its contents change.
 * Returns the absolute path written, or `null` when no `package.json` is found.
 */
export async function generateResolvedConfig(from: string = process.cwd()): Promise<string | null> {
  const dir = await codegenBucket(from, 'node');
  if (isNull(dir)) return null;

  const layers = useLayers();
  const strategies = layers.strategies();
  let defaults = layers
    .layers()
    .reduce<Record<string, unknown>>((acc, layer) => merge(acc, layer.defaults), {});
  for (const [path, strategy] of Object.entries(strategies)) {
    if (strategy === 'own') defaults = dotUnset(defaults, path);
  }

  const code = createCodeBuilder();
  code.line("import type {} from 'ohnejs';");
  code.line();
  code.line("declare module 'ohnejs' {");
  code.indent(() => {
    if (isEmpty(defaults)) {
      code.line('interface ConfigExtensions {}');
    } else {
      code.line('interface ConfigExtensions {');
      code.indent(() => {
        code.line('defaults: {');
        code.indent(() => writeDefaults(code, defaults, strategies));
        code.line('};');
      });
      code.line('}');
    }
  });
  code.line('}');

  const gen = createCodeGenerator({ dir, banner: BANNER });
  await gen.write('resolved-config.ts', code.toString());
  return gen.path('resolved-config.ts');
}
