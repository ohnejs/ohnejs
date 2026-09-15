import { last } from '../array/last.ts';
import { withDefaults, type WithDefaultsStrategy } from '../defaults/with-defaults.ts';
import { isNull } from '../is/is-null.ts';
import { isUndefined } from '../is/is-undefined.ts';
import { ref } from '../reactive/ref.ts';

/**
 * `withDefaults` strategies keyed by dot-notation path.
 * Shared between per-layer and cross-layer merges in `createLayerRegistry`.
 */
export type LayerStrategies = Record<string, WithDefaultsStrategy>;

/**
 * Options for `createLayerRegistry`.
 */
export interface LayerRegistryOptions {
  /**
   * Initial `withDefaults` strategies.
   * Extend later via `setStrategy(path, value)`.
   *
   * @default
   * {}
   */
  strategies?: LayerStrategies;
}

/**
 * Description of a layer to register.
 * `defaults` and `input` both default to `{}`.
 */
export interface LayerSpec<C extends object> {
  /**
   * Absolute path of the layer.
   * Stored as given - no normalisation.
   */
  path: string;

  /**
   * Display name of the layer.
   * Carried through to `Layer` untouched; the registry never reads it.
   */
  name?: string;

  /**
   * Default config the layer ships with.
   *
   * @default
   * {}
   */
  defaults?: Partial<C>;

  /**
   * Input config the layer's author provided.
   *
   * @default
   * {}
   */
  input?: Partial<C>;
}

/**
 * A registered layer with its cumulative resolved config.
 *
 * `resolved` is the cumulative fold through this layer: closer layers win, base layers fill.
 * The closest layer's `resolved` therefore equals the final config.
 */
export interface Layer<C extends object> {
  /**
   * Absolute path of the layer, as given to `add`.
   */
  path: string;

  /**
   * Display name of the layer, as given to `add`.
   */
  name?: string;

  /**
   * Default config the layer was registered with, normalised to `{}` if omitted.
   */
  defaults: Partial<C>;

  /**
   * Input config the layer was registered with, normalised to `{}` if omitted.
   */
  input: Partial<C>;

  /**
   * Cumulative resolved config from the base layer up through this one.
   */
  resolved: Partial<C>;
}

/**
 * Ordered registry of layers with cumulative config resolution.
 *
 * Layers are registered in insertion order; closer = later.
 * Paths are unique - adding a second layer at the same path throws.
 * Strategies are shared between per-layer and cross-layer merges.
 * Results are cached and invalidated on `add`, `remove`, `clear`, or `setStrategy`.
 * `X` names extra fields a spec carries; they pass through to the layer unread.
 */
export interface LayerRegistry<C extends object, X extends object = object> {
  /**
   * Appends a layer.
   * Closer than every layer added before it.
   * Throws when a layer is already registered at `spec.path`.
   */
  add(spec: LayerSpec<C> & X): void;

  /**
   * Removes the layer registered at `path`.
   * Returns `true` if a layer was removed.
   */
  remove(path: string): boolean;

  /**
   * Removes every registered layer and restores strategies to the ones seeded at construction.
   * A subsequent `add` may reuse any previously registered path.
   */
  clear(): void;

  /**
   * Returns every registered layer in insertion order, with cumulative `resolved` filled in.
   * Base layer first, closest layer last.
   */
  layers(): readonly (Layer<C> & X)[];

  /**
   * Sets the merge strategy at `path` for both per-layer and cross-layer merges.
   * Overwrites any existing strategy at the same path.
   *
   * `path` is dot-notation: `'tags'`, `'server.routes'`, `'items[0].tag'`.
   * See `WithDefaultsStrategy` for the available strategies.
   *
   * @example
   * ```ts
   * const registry = createLayerRegistry<{ tags: string[] }>()
   *
   * registry.add({ path: '/base', defaults: { tags: ['core'] } })
   * registry.add({ path: '/user', input:    { tags: ['custom'] } })
   *
   * registry.resolve()
   * // -> { tags: ['custom'] }
   *
   * registry.setStrategy('tags', 'concat-unique')
   * registry.resolve()
   * // -> { tags: ['custom', 'core'] }
   * ```
   */
  setStrategy(path: string, strategy: WithDefaultsStrategy): void;

  /**
   * Returns a shallow copy of every configured strategy.
   */
  strategies(): LayerStrategies;

  /**
   * Returns the final merged config.
   * Returns `{} as C` if no layers are registered.
   */
  resolve(): C;
}

/**
 * Creates a typed layer registry.
 *
 * Each layer is stored as `{ path, name, defaults, input, resolved }`.
 * Extra fields a spec carries, typed by `X`, pass through to the layer untouched.
 * `resolved` folds the layer via `withDefaults` using the registry's strategies.
 * Closer layers win; base layers fill.
 *
 * Paths are unique - adding a second layer at the same path throws.
 * Strategies apply to per-layer and cross-layer merges alike.
 * Extend them at any time via `setStrategy`.
 * Results are cached and invalidated on `add`, `remove`, `clear`, or `setStrategy`.
 *
 * @example
 * ```ts
 * interface Settings { tags: string[]; routes: string[] }
 *
 * const registry = createLayerRegistry<Settings>({
 *   strategies: { tags: 'concat-unique', routes: 'concat' },
 * })
 *
 * registry.add({ path: '/base', defaults: { tags: ['core'], routes: [] } })
 * registry.add({ path: '/user', input:    { tags: ['user'] } })
 *
 * registry.resolve() // -> { tags: ['user', 'core'], routes: [] }
 *
 * registry.setStrategy('tags', 'replace')
 * registry.resolve() // -> { tags: ['user'], routes: [] }
 * ```
 */
export function createLayerRegistry<C extends object, X extends object = object>(
  options?: LayerRegistryOptions,
): LayerRegistry<C, X> {
  const specs: (LayerSpec<C> & X)[] = [];
  const seed: LayerStrategies = { ...options?.strategies };
  let strategies: LayerStrategies = { ...seed };
  let cached: (Layer<C> & X)[] | null = null;
  const version = ref(0);

  /**
   * Drops the cached fold and bumps `version`, re-running effects that read the registry.
   */
  function invalidate(): void {
    cached = null;
    version.value++;
  }

  /**
   * Returns the cached layers, refolding every spec base-first after an invalidation.
   */
  function ensureFresh(): (Layer<C> & X)[] {
    if (!isNull(cached)) return cached;
    const result: (Layer<C> & X)[] = [];
    let cumulative: Partial<C> | undefined;
    for (const spec of specs) {
      const defaults: Partial<C> = spec.defaults ?? {};
      const input: Partial<C> = spec.input ?? {};
      const own = withDefaults(input, defaults, { strategies });
      cumulative = isUndefined(cumulative) ? own : withDefaults(own, cumulative, { strategies });
      result.push({ ...spec, defaults, input, resolved: cumulative });
    }
    cached = result;
    return result;
  }

  return {
    add(spec) {
      if (specs.some((s) => s.path === spec.path)) {
        throw new Error(`Layer already registered at path: ${spec.path}`);
      }
      specs.push(spec);
      invalidate();
    },
    remove(path) {
      const idx = specs.findIndex((s) => s.path === path);
      if (idx === -1) return false;
      specs.splice(idx, 1);
      invalidate();
      return true;
    },
    clear() {
      specs.length = 0;
      strategies = { ...seed };
      invalidate();
    },
    layers() {
      void version.value;
      return ensureFresh();
    },
    setStrategy(path, value) {
      strategies[path] = value;
      invalidate();
    },
    strategies() {
      void version.value;
      return { ...strategies };
    },
    resolve() {
      void version.value;
      const all = ensureFresh();
      if (all.length === 0) return {} as C;
      return last(all)!.resolved as C;
    },
  };
}
