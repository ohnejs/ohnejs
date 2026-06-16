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
   * Extend later via `strategy(path, value)`.
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
   * Defaults the layer ships with.
   *
   * @default
   * {}
   */
  defaults?: Partial<C>;

  /**
   * Config the layer's author provided.
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
   * Defaults the layer was registered with, normalised to `{}` if omitted.
   */
  defaults: Partial<C>;

  /**
   * Input the layer was registered with, normalised to `{}` if omitted.
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
 * Results are cached and invalidated on `add`, `remove`, or `strategy`.
 */
export interface LayerRegistry<C extends object> {
  /**
   * Appends a layer.
   * Closer than every layer added before it.
   * Throws when a layer is already registered at `spec.path`.
   * Invalidates the cache.
   */
  add(spec: LayerSpec<C>): void;

  /**
   * Removes the layer registered at `path`.
   * Returns `true` if a layer was removed.
   * Invalidates the cache.
   */
  remove(path: string): boolean;

  /**
   * Returns every registered layer in insertion order, with cumulative `resolved` filled in.
   * Cached between mutations.
   */
  layers(): readonly Layer<C>[];

  /**
   * Sets the `withDefaults` strategy at `path`.
   * Overwrites any existing strategy.
   * Invalidates the cache.
   */
  strategy(path: string, strategy: WithDefaultsStrategy): void;

  /**
   * Returns a shallow copy of every configured strategy.
   */
  strategies(): LayerStrategies;

  /**
   * Returns the final resolved config: the closest layer's `resolved`, cast to `C`.
   * Returns `{} as C` if no layers are registered.
   */
  resolve(): C;
}

/**
 * Creates a typed layer registry.
 *
 * Each layer is stored as `{ path, defaults, input, resolved }`.
 * `resolved` folds the layer via `withDefaults` using the registry's strategies.
 * Closer layers win; base layers fill.
 *
 * Paths are unique - adding a second layer at the same path throws.
 * Strategies apply to per-layer and cross-layer merges alike.
 * Extend them at any time via `strategy`.
 * Results are cached and invalidated on `add`, `remove`, or `strategy`.
 *
 * @example
 * ```ts
 * interface Config { tags: string[]; routes: string[] }
 *
 * const registry = createLayerRegistry<Config>({
 *   strategies: { tags: 'concat-unique', routes: 'concat' },
 * })
 *
 * registry.add({ path: '/base', defaults: { tags: ['core'], routes: [] } })
 * registry.add({ path: '/user', input: { tags: ['user'] } })
 *
 * registry.resolve() // -> { tags: ['user', 'core'], routes: [] }
 *
 * registry.strategy('tags', 'replace')
 * registry.resolve() // -> { tags: ['user'], routes: [] }
 * ```
 */
export function createLayerRegistry<C extends object>(
  options?: LayerRegistryOptions,
): LayerRegistry<C> {
  const specs: LayerSpec<C>[] = [];
  const strategies: LayerStrategies = { ...options?.strategies };
  let cached: Layer<C>[] | null = null;
  const version = ref(0);

  function invalidate(): void {
    cached = null;
    version.value++;
  }

  function ensureFresh(): Layer<C>[] {
    if (!isNull(cached)) return cached;
    const result: Layer<C>[] = [];
    let cumulative: Partial<C> | undefined;
    for (const spec of specs) {
      const defaults: Partial<C> = spec.defaults ?? {};
      const input: Partial<C> = spec.input ?? {};
      const own = withDefaults(input, defaults, { strategies });
      cumulative = isUndefined(cumulative) ? own : withDefaults(own, cumulative, { strategies });
      result.push({ path: spec.path, defaults, input, resolved: cumulative });
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
    layers() {
      void version.value;
      return ensureFresh();
    },
    strategy(path, value) {
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
