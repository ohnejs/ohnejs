import type { HTTPMethod } from 'ohnejs/utils';

import { routeGlobMatcher, useConfig } from 'ohnejs';
import { isUndefined } from 'ohnejs/utils';

import type { AITier } from '../config.ts';

import { useAIConfig } from '../config.ts';

/**
 * The two prefixes no routes table can open: the session routes and the assistant's own.
 */
const HARD_DENIED = ['/auth/**', '/ai/**'];

interface TableRow {
  matches: (method: HTTPMethod | null, pattern: string) => boolean;
  tier: AITier | false;
}

const hardDenied = routeGlobMatcher(HARD_DENIED);
const tables = new WeakMap<object, TableRow[]>();

/**
 * The tier `ai.routes` gives a route, `false` when it forbids it, `undefined` when no key matches.
 * The first matching key in object order decides.
 * A route under `/auth/` or `/ai/` is `false` whatever the table says.
 *
 * @example
 * ```ts
 * tierOf('POST', '/collections/[collection]/query')  // -> 'read'
 * tierOf('DELETE', '/collections/[collection]/[uuid]') // -> 'destructive'
 * tierOf('POST', '/auth/login')                      // -> false
 * tierOf('GET', '/reports')                          // -> undefined
 * ```
 */
export function tierOf(method: HTTPMethod | null, pattern: string): AITier | false | undefined {
  if (hardDenied(method, pattern)) return false;
  return routeTable().find((row) => row.matches(method, pattern))?.tier;
}

/**
 * The compiled routes table, built once per resolved config.
 */
function routeTable(): TableRow[] {
  const config = useConfig();
  let table = tables.get(config);
  if (isUndefined(table)) {
    table = Object.entries(useAIConfig().routes).map(([glob, tier]) => ({
      matches: routeGlobMatcher([glob]),
      tier,
    }));
    tables.set(config, table);
  }
  return table;
}
