import type { MaybeGetter } from '../../utils/reactive/to-value.ts';
import type { SearchParamValue } from '../../utils/search-params/coerce-token.ts';
import type { APIRouteID } from './known-api-routes.ts';
import type { Resource, RouteValues } from './resource.ts';

import { isEmpty } from '../../utils/is/is-empty.ts';
import { isPlainObject } from '../../utils/is/is-plain-object.ts';
import { isUndefined } from '../../utils/is/is-undefined.ts';
import { mapValues } from '../../utils/object/map-values.ts';
import { ref } from '../../utils/reactive/ref.ts';
import { toValue } from '../../utils/reactive/to-value.ts';
import { untracked } from '../../utils/reactive/untracked.ts';
import { parseRetryAfter } from '../../utils/retry-after/parse-retry-after.ts';
import { fillRoute } from '../../utils/route/fill-route.ts';
import { parseRouteID } from '../../utils/route/parse-route-id.ts';
import { stringifySearchParams } from '../../utils/search-params/stringify-search-params.ts';
import { sleep } from '../../utils/sleep/sleep.ts';
import { toast } from '../ui/toaster.ts';
import { type APIError, readAPIError, unreachableError } from './api-error.ts';
import { api } from './api.ts';
import { defaultText } from './text.ts';
import { translateMessage } from './use-t.ts';

/**
 * What one `run` sends, on top of the action's own options.
 */
export interface ActionRequest {
  /**
   * Values for the route's `[param]` segments, merged over the action's `params`.
   */
  params?: RouteValues;

  /**
   * The URL query.
   */
  query?: Record<string, SearchParamValue | undefined>;

  /**
   * The JSON body; given, it is sent instead of the bound form's values.
   */
  body?: unknown;
}

/**
 * A form's read, as a value to send or the local messages that block it.
 */
export interface ActionFormReading {
  /**
   * The value to send.
   */
  value?: unknown;

  /**
   * Local messages keyed by field path; present, nothing is sent.
   */
  errors?: Readonly<Record<string, string>>;
}

/**
 * The part of a form `useAction` drives: it reads the body, places errors, and re-baselines after a save.
 */
export interface ActionForm {
  /**
   * Reads the whole value, sent by every method but `PATCH`.
   */
  read(): ActionFormReading;

  /**
   * Reads only the changed fields, sent by a `PATCH`.
   */
  readPatch(): ActionFormReading;

  /**
   * Shows messages on their fields and focuses the first one placed.
   * Returns the first message no field takes, or `''` when every message placed.
   */
  setErrors(errors: Readonly<Record<string, string>>): string;

  /**
   * Re-baselines the form to the values just saved, a partial patch included, so it reads clean.
   */
  rebase(value: Readonly<Record<string, unknown>>): void;

  /**
   * Disables the form while a call it fed is in flight.
   */
  setBusy(busy: boolean): void;
}

/**
 * Options for `useAction`.
 */
export interface ActionOptions<T> {
  /**
   * Values for the route's `[param]` segments; a getter is read on each `run`.
   */
  params?: MaybeGetter<RouteValues>;

  /**
   * The form whose values a `run` without a `body` sends, and whose fields take a `422`'s messages.
   */
  form?: ActionForm;

  /**
   * Resources to reload after a success.
   */
  reload?: readonly Resource<unknown>[];

  /**
   * Called after a success with the parsed answer, `null` when the body is empty or not JSON.
   */
  onDone?: (result: T) => void;

  /**
   * Called on a failure in place of the error toast; a `401` calls nothing.
   */
  onError?: (error: APIError) => void;
}

/**
 * A write bound to one route, run on demand.
 */
export interface APIAction {
  /**
   * Sends the request and resolves whether it succeeded.
   * A failed request never rejects; a missing route param throws, as `fillRoute` does.
   */
  run(request?: ActionRequest): Promise<boolean>;

  /**
   * Whether a call is in flight; with `params`, only the call to that filled path. Reactive.
   */
  busy(params?: RouteValues): boolean;
}

interface Call {
  key: string;
  path: string;
  bound: boolean;
}

/**
 * Binds a write to a route: `run` sends it as JSON and reports the outcome itself.
 * A `run` while the same request is in flight resolves `false` and sends nothing.
 * Without a `body`, a bound `form` supplies it: `readPatch` for a `PATCH`, `read` otherwise.
 * Local form errors and an empty patch send nothing.
 * A busy `503` is retried once, after its `Retry-After` or a second.
 * A `422` routes its `data.errors` onto the form's fields and toasts the error count.
 * A `401` is left to the session handler; any other failure toasts the server's message.
 * `onError` replaces every failure toast.
 * On success the form is rebased, the `reload` resources reload, and `onDone` gets the answer.
 * A bare-path id sends `POST`.
 *
 * @example
 * ```ts
 * const settings = useResource<Settings>('GET /guild/settings')
 * const save = useAction('PATCH /guild/settings', { reload: [settings] })
 *
 * button('Save', { loading: () => save.busy(), onClick: () => save.run({ body: { motd } }) })
 * ```
 */
export function useAction<T = unknown>(
  route: APIRouteID,
  options: ActionOptions<T> = {},
): APIAction {
  const { method = 'POST', path: pattern } = parseRouteID(route);
  const { form } = options;
  const calls = ref<readonly Call[]>([]);

  const pathOf = (params: RouteValues | undefined): string =>
    fillRoute(
      pattern,
      mapValues({ ...toValue(options.params), ...params }, (_, value) => String(value)),
    );

  const finish = (call: Call): void => {
    calls.value = calls.value.filter((entry) => entry !== call);
    form?.setBusy(calls.value.some((entry) => entry.bound));
  };

  const fail = (error: APIError): void => {
    if (error.status === 401) return;
    const errors = error.status === 422 ? errorsOf(error.data) : undefined;
    const unplaced = isUndefined(errors) || isUndefined(form) ? undefined : form.setErrors(errors);
    if (!isUndefined(options.onError)) options.onError(error);
    else if (!isUndefined(errors) && !isEmpty(errors)) {
      const rows = isUndefined(unplaced)
        ? Object.entries(errors).map(([path, message]) => `\`${path}\`: ${message}`)
        : [unplaced].filter((message) => message !== '');
      toast(foundErrors(Object.keys(errors).length), {
        type: 'error',
        description: rows.length === 0 ? undefined : rows.join('\n'),
      });
    } else toast(error.message, { type: 'error' });
  };

  return {
    async run(request = {}) {
      const path = untracked(() => pathOf(request.params));
      const search = stringifySearchParams(request.query ?? {});
      const target = `${method} ${search === '' ? path : `${path}?${search}`}`;
      if (untracked(() => calls.value).some((call) => call.key === target)) return false;

      let body = request.body;
      const bound = isUndefined(body) && !isUndefined(form);
      if (bound) {
        const reading = method === 'PATCH' ? form.readPatch() : form.read();
        if (!isUndefined(reading.errors)) {
          form.setErrors(reading.errors);
          return false;
        }
        if (method === 'PATCH' && isEmpty(reading.value)) return false;
        body = reading.value;
      }

      const call: Call = { key: target, path, bound };
      calls.value = [...calls.value, call];
      if (bound) form.setBusy(true);
      const answer = await send(target, body);
      finish(call);

      if ('error' in answer) {
        fail(answer.error);
        return false;
      }
      if (bound && isPlainObject(body)) form.rebase(body);
      for (const resource of options.reload ?? []) void resource.reload();
      options.onDone?.(answer.result as T);
      return true;
    },

    busy(params) {
      if (isUndefined(params)) return calls.value.length > 0;
      const path = pathOf(params);
      return calls.value.some((call) => call.path === path);
    },
  };
}

/**
 * Sends `body` as JSON to `target`, retrying a busy `503` once.
 * Resolves the parsed answer, or the failure.
 */
async function send(
  target: string,
  body: unknown,
): Promise<{ result: unknown } | { error: APIError }> {
  const init: RequestInit = isUndefined(body)
    ? {}
    : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) };
  try {
    let response = await api(target, init);
    if (response.status === 503) {
      await sleep(parseRetryAfter(response.headers.get('retry-after')) ?? 1000);
      response = await api(target, init);
    }
    if (!response.ok) {
      const fallback = defaultText('dashboard.writeFailed', 'The write failed');
      return { error: await readAPIError(response, fallback) };
    }
    const text = await response.text();
    return { result: text === '' ? null : parseJSON(text) };
  } catch {
    return { error: unreachableError() };
  }
}

/**
 * Parses `text` as JSON, or `null` when it is not.
 */
function parseJSON(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/**
 * The per-field messages of a `422`'s `data`, or `undefined` when it carries none.
 */
function errorsOf(data: unknown): Readonly<Record<string, string>> | undefined {
  if (!isPlainObject(data) || !isPlainObject(data.errors)) return undefined;
  return data.errors as Readonly<Record<string, string>>;
}

/**
 * The live "Found N errors" toast title, in plain English when no catalog defines it.
 */
function foundErrors(count: number): () => string {
  return () => {
    const text = translateMessage({ key: 'dashboard.foundErrors', params: { count } });
    if (text !== 'dashboard.foundErrors') return text;
    return count === 1 ? 'Found 1 error' : `Found ${count} errors`;
  };
}
