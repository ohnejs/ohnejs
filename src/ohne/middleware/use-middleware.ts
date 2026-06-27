import type { Middleware } from './middleware.ts';

import { createRegistry, type Registry } from '../../utils/index.ts';

/**
 * The process-wide middleware store, keyed by resolved name.
 *
 * Holds both tiers: global middleware that run on every request, and named middleware a route opts into.
 * `register` adds a named middleware; `registerGlobal` adds a global one in run order.
 * Registering an existing name overrides it, so a closer layer's middleware wins.
 *
 * The generated `middleware.ts` populates it at boot; `dispatch` reads it once per request.
 */
export interface MiddlewareRegistry {
  /**
   * Registers a named, opt-in middleware under `key`.
   * A route runs it only by selecting it through `defineHandler`'s `middleware` option.
   */
  register(key: string, middleware: Middleware): void;

  /**
   * Registers a global middleware under `key`.
   * Global middleware run on every request, before any named one, in registration order.
   */
  registerGlobal(key: string, middleware: Middleware): void;

  /**
   * Returns the middleware registered under `key`, global or named, or `undefined` if none.
   */
  get(key: string): Middleware | undefined;

  /**
   * Returns the global middleware names, in run order.
   */
  globalKeys(): string[];

  /**
   * Returns the named, opt-in middleware names, in registration order.
   */
  namedKeys(): string[];

  /**
   * Removes every entry, global and named.
   */
  clear(): void;
}

const store: Registry<Middleware> = createRegistry<Middleware>();
const globals: string[] = [];
const named: string[] = [];

const registry: MiddlewareRegistry = {
  register(key, middleware) {
    if (!store.has(key)) named.push(key);
    store.register(key, middleware);
  },
  registerGlobal(key, middleware) {
    if (!store.has(key)) globals.push(key);
    store.register(key, middleware);
  },
  get(key) {
    return store.get(key);
  },
  globalKeys() {
    return [...globals];
  },
  namedKeys() {
    return [...named];
  },
  clear() {
    store.clear();
    globals.length = 0;
    named.length = 0;
  },
};

/**
 * Returns the process-wide middleware registry.
 *
 * Global middleware run on every request, in the order they were registered, before any named ones.
 * Named middleware sit idle until a route selects them through `defineHandler`'s `middleware` option.
 * Registering an existing name overrides it, so a closer layer's middleware wins.
 *
 * @example
 * ```ts
 * useMiddleware().registerGlobal('global-id', (event) => {
 *   event.context.requestId = crypto.randomUUID()
 * })
 *
 * useMiddleware().globalKeys() // -> ['global-id']
 * ```
 */
export function useMiddleware(): MiddlewareRegistry {
  return registry;
}
