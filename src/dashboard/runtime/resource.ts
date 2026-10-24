import type { MaybeGetter } from '../../utils/reactive/to-value.ts';
import type { SearchParamValue } from '../../utils/search-params/coerce-token.ts';
import type { APIRouteID } from './known-api-routes.ts';

import { isUndefined } from '../../utils/is/is-undefined.ts';
import { mapValues } from '../../utils/object/map-values.ts';
import { computed } from '../../utils/reactive/computed.ts';
import { onCleanup } from '../../utils/reactive/effect-scope.ts';
import { effect } from '../../utils/reactive/effect.ts';
import { ref } from '../../utils/reactive/ref.ts';
import { toValue } from '../../utils/reactive/to-value.ts';
import { untracked } from '../../utils/reactive/untracked.ts';
import { fillRoute } from '../../utils/route/fill-route.ts';
import { parseRouteID } from '../../utils/route/parse-route-id.ts';
import { stringifySearchParams } from '../../utils/search-params/stringify-search-params.ts';
import { type FlightTicket, joinFlight, type Settled, cachedAnswer } from './_resource-cache.ts';
import { type APIError, readAPIError, unreachableError } from './api-error.ts';
import { api } from './api.ts';
import { dataChangeCount } from './data-changes.ts';
import { signInCount } from './session.ts';
import { defaultText } from './text.ts';
import { requestedLanguage } from './use-dashboard-language.ts';

/**
 * Where a `Resource` stands.
 * `'loading'` lasts until a value arrives; `'forbidden'` is a `403`; `'error'` is any other failure.
 */
export type ResourceState = 'loading' | 'ready' | 'error' | 'forbidden';

/**
 * A live API read: call it for the value, `undefined` while nothing has arrived.
 */
export interface Resource<T> {
  /**
   * The latest value, `undefined` until the first answer lands.
   */
  (): T | undefined;

  /**
   * Where the read stands.
   */
  state(): ResourceState;

  /**
   * The last failure, cleared by the next success.
   */
  error(): APIError | undefined;

  /**
   * Whether the value is a stand-in from another query, shown until the answer for this one lands.
   */
  stale(): boolean;

  /**
   * Whether the first load or a `reload` is in flight; poll ticks do not count.
   */
  busy(): boolean;

  /**
   * Sends a fresh request and resolves once it settles.
   */
  reload(): Promise<void>;

  /**
   * A resource over a slice of the value, sharing this one's state.
   */
  pick<R>(select: (value: T) => R): Resource<R>;
}

/**
 * Values filled into a route pattern's `[param]` segments.
 */
export type RouteValues = Record<string, string | number>;

/**
 * What `useResource` sends.
 */
export interface ResourceOptions {
  /**
   * The values filled into the route's `[param]` segments.
   * A getter is tracked; answering `undefined` pauses the read.
   */
  params?: MaybeGetter<RouteValues | undefined>;

  /**
   * The URL query.
   * A getter is tracked; answering `undefined` pauses the read.
   */
  query?: MaybeGetter<Record<string, SearchParamValue | undefined> | undefined>;

  /**
   * A JSON body, for reads sent as `POST`.
   * A getter is tracked; answering `undefined` pauses the read.
   */
  body?: MaybeGetter<unknown>;

  /**
   * Refetches every this many milliseconds while the tab is visible.
   */
  poll?: number;

  /**
   * Milliseconds before a request counts as failed.
   *
   * @default
   * 15_000
   */
  timeout?: number;
}

interface Target {
  route: string;
  init: RequestInit;
  key: string;
  standInKey: string;
}

interface Shared {
  state(): ResourceState;
  error(): APIError | undefined;
  stale(): boolean;
  busy(): boolean;
  reload(): Promise<void>;
}

const BRAND = Symbol('resource');

/**
 * Reads a route into a live value, shared and cached across the dashboard.
 * The `params`, `query`, and `body` getters are tracked: a change sends the new request.
 * Any of them answering `undefined` pauses the read.
 * A cached answer for the same request shows at once and revalidates quietly.
 * Otherwise the last value for another query of the read stays, `stale`, until the new answer lands.
 * A failure drops a stale value, so an error never shows over data from another query.
 * Requests with the same key share one fetch, aborted once its last reader's scope is disposed.
 * A `403` reads as `'forbidden'`; a `401` is left to the session handler and changes nothing.
 * Each sign-in in place sends a fresh request, so a read refused on an expired session recovers.
 * Each `markDataChanged` refetches quietly, so a write sent from outside the page shows.
 * Any other failure reads as `'error'` and keeps the last value; a read never retries on its own.
 * A bare-path id reads with `GET`.
 * `T` is your claim about the answer; nothing checks it against the server.
 *
 * @example
 * ```ts
 * const range = useSearchParam('range', { fallback: '7d' })
 * const sales = useResource<Sales>('GET /shops/[shop]/sales', {
 *   params: { shop: 'orgrimmar' },
 *   query: () => ({ range: range.value }),
 *   poll: 60_000,
 * })
 *
 * sales()       // -> undefined, then the answer
 * sales.state() // -> 'loading', then 'ready'
 * ```
 */
export function useResource<T = unknown>(
  route: APIRouteID,
  options: ResourceOptions = {},
): Resource<T> {
  const { method = 'GET', path: pattern } = parseRouteID(route);
  const { poll, timeout = 15_000 } = options;
  const value = ref<T | undefined>(undefined);
  const state = ref<ResourceState>('loading');
  const error = ref<APIError | undefined>(undefined);
  const stale = ref(false);
  const busy = ref(false);
  let target: Target | undefined;
  let ticket: FlightTicket | undefined;
  let generation = 0;
  let pending = false;

  const settle = (settled: Settled | undefined): void => {
    pending = false;
    busy.value = false;
    if (isUndefined(settled)) return;
    if (isUndefined(settled.error)) {
      value.value = settled.value as T;
      error.value = undefined;
      stale.value = false;
      state.value = 'ready';
    } else if (settled.error.status !== 401) {
      if (stale.value) {
        value.value = undefined;
        stale.value = false;
      }
      error.value = settled.error;
      state.value = settled.error.status === 403 ? 'forbidden' : 'error';
    }
  };

  const load = (fresh: boolean, quiet: boolean): Promise<void> => {
    ticket?.release();
    ticket = undefined;
    const id = ++generation;
    pending = !isUndefined(target);
    busy.value = pending && !quiet;
    if (isUndefined(target)) return Promise.resolve();
    const current = target;
    ticket = joinFlight(
      languageKey(current.key),
      languageKey(current.standInKey),
      (signal) => send(current, signal, timeout),
      fresh,
    );
    return ticket.settled.then((settled) => {
      if (id === generation) settle(settled);
    });
  };

  const retarget = (next: Target | undefined): void => {
    if (next?.key === target?.key) return;
    const ownStandIn = !isUndefined(value.value) && target?.standInKey === next?.standInKey;
    target = next;
    if (isUndefined(next)) {
      void load(false, true);
      return;
    }
    const cached = cachedAnswer(languageKey(next.key), languageKey(next.standInKey));
    const fresh = cached?.stale === false;
    if (!fresh && ownStandIn) stale.value = true;
    else {
      value.value = cached?.value as T | undefined;
      stale.value = cached?.stale === true;
    }
    error.value = undefined;
    state.value = isUndefined(value.value) ? 'loading' : 'ready';
    void load(false, fresh);
  };

  effect(() => {
    const next = targetOf(method, pattern, options);
    untracked(() => retarget(next));
  });

  let signedIn = false;
  effect(() => {
    signInCount();
    if (signedIn && !isUndefined(target)) untracked(() => void load(true, false));
    signedIn = true;
  });

  let changed = false;
  effect(() => {
    dataChangeCount();
    if (changed && !isUndefined(target)) untracked(() => void load(false, true));
    changed = true;
  });

  if (!isUndefined(poll)) {
    let missed = false;
    const tick = (): void => {
      if (document.visibilityState !== 'visible') missed = true;
      else if (!pending) void load(false, true);
    };
    const onVisibility = (): void => {
      if (!missed || document.visibilityState !== 'visible') return;
      missed = false;
      tick();
    };
    const timer = setInterval(tick, poll);
    document.addEventListener('visibilitychange', onVisibility);
    onCleanup(() => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisibility);
    });
  }

  onCleanup(() => {
    generation += 1;
    ticket?.release();
  });

  return resourceOf(() => value.value, {
    state: () => state.value,
    error: () => error.value,
    stale: () => stale.value,
    busy: () => busy.value,
    reload: () => (isUndefined(target) ? Promise.resolve() : load(true, false)),
  });
}

/**
 * The state of `source` when it is a `Resource`, or `undefined` for a plain getter.
 * Kit data components read it to tell an error or a `403` from a slow load.
 */
export function resourceState(source: () => unknown): ResourceState | undefined {
  return isResource(source) ? source.state() : undefined;
}

/**
 * Whether `source` is a `Resource` rather than a plain getter.
 */
export function isResource(source: () => unknown): source is Resource<unknown> {
  return BRAND in source;
}

/**
 * Brands `get` as a resource over the `shared` state, with `pick` deriving slices of it.
 */
function resourceOf<T>(get: () => T | undefined, shared: Shared): Resource<T> {
  const pick = <R>(select: (value: T) => R): Resource<R> => {
    const slice = computed(() => {
      const current = get();
      if (isUndefined(current)) return undefined;
      try {
        return select(current);
      } catch (failure) {
        // A stand-in answered another query, so its shape may not fit `select`.
        if (shared.stale()) return undefined;
        throw failure;
      }
    });
    return resourceOf(() => slice.value, shared);
  };
  return Object.assign(get, shared, { pick, [BRAND]: true }) as Resource<T>;
}

/**
 * The request `options` currently describe, or `undefined` while a getter pauses it.
 */
function targetOf(method: string, pattern: string, options: ResourceOptions): Target | undefined {
  const params = isUndefined(options.params) ? {} : toValue(options.params);
  const query = isUndefined(options.query) ? {} : toValue(options.query);
  const body = toValue(options.body);
  const paused = !isUndefined(options.body) && isUndefined(body);
  if (isUndefined(params) || isUndefined(query) || paused) return undefined;
  const path = fillRoute(
    pattern,
    mapValues(params, (_, param) => String(param)),
  );
  const search = stringifySearchParams(query);
  const filled = search === '' ? path : `${path}?${search}`;
  const json = isUndefined(body) ? '' : JSON.stringify(body);
  return {
    route: `${method} ${filled}`,
    init: json === '' ? {} : { headers: { 'content-type': 'application/json' }, body: json },
    key: `${method} ${filled} ${json}`,
    standInKey: `${method} ${path} ${json}`,
  };
}

/**
 * `key` under the language a request sent now goes out in, read untracked.
 */
function languageKey(key: string): string {
  return `${untracked(() => requestedLanguage().value)} ${key}`;
}

/**
 * Sends `target` and reads its answer; `undefined` once `signal` aborted it.
 */
async function send(
  target: Target,
  signal: AbortSignal,
  timeout: number,
): Promise<Settled | undefined> {
  const loadFailed = (): string => defaultText('dashboard.loadFailed', 'Failed to load');
  try {
    const response = await api(target.route, {
      ...target.init,
      signal: AbortSignal.any([signal, AbortSignal.timeout(timeout)]),
    });
    if (!response.ok) return { error: await readAPIError(response, loadFailed()) };
    return await response.json().then(
      (value: unknown) => ({ value }),
      () => ({ error: { status: response.status, message: loadFailed() } }),
    );
  } catch {
    return signal.aborted ? undefined : { error: unreachableError() };
  }
}
