import { isUndefined } from '../../../utils/index.ts';
import { tryUseDialect } from '../../database/use-database.ts';
import { useConfig } from '../../layers/use-config.ts';

/**
 * The DoS guards that bound a wire-driven query, resolved per key across tiers.
 *
 * Framework defaults, then `config.query.guards` app-wide, then what an endpoint passes to `resolveGuards`.
 * They gate the untrusted wire path; the fluent path is trusted and never guard-checked.
 * Every field is a generous ceiling, not policy: a real query never approaches one.
 */
export interface QueryGuards {
  /**
   * The most comparison leaves one condition may carry.
   *
   * @default
   * 100
   */
  maxConditions: number;

  /**
   * The deepest a `has` may nest into related scopes.
   *
   * @default
   * 8
   */
  maxHasDepth: number;

  /**
   * The most elements an `in` list may hold.
   *
   * @default
   * 2000
   */
  maxInLength: number;

  /**
   * The most parameters an untrusted query may bind in total, across every value it filters on.
   * Resolved against the dialect's own limit, so a config may lower it but never raise it past the driver.
   *
   * @default
   * 10000
   */
  maxBoundParams: number;

  /**
   * The most top-level fields a `select` may name.
   *
   * @default
   * 200
   */
  maxSelect: number;

  /**
   * The most `order` keys a query may stack.
   *
   * @default
   * 10
   */
  maxOrder: number;

  /**
   * The most nodes a `populate` tree may hold in total, bare names and specs alike.
   *
   * @default
   * 20
   */
  maxPopulate: number;

  /**
   * The deepest a `populate` may nest; root relations are depth `1`.
   * Depth past the default is new transitive reach across collections.
   * Raising it is an explicit endpoint decision.
   *
   * @default
   * 2
   */
  maxPopulateDepth: number;

  /**
   * The most bytes a single bound string value may weigh, UTF-8.
   *
   * @default
   * 4096
   */
  maxValueBytes: number;

  /**
   * The most bytes a `contains`/`startsWith`/`endsWith`/`like` pattern may weigh, matching being `O(n*m)`.
   *
   * @default
   * 512
   */
  maxPatternBytes: number;

  /**
   * The most rows a read outside pagination answers.
   * A larger `limit` is lowered to it, and a read that names no `limit`, `page` or `perPage` stops at it.
   * Keep it at or above `maxInLength`, so a `UUID` `in` lookup answers every row it names.
   *
   * @default
   * 2000
   */
  maxLimit: number;

  /**
   * The largest page a paginated endpoint may serve.
   *
   * @default
   * 500
   */
  maxPerPage: number;
}

/**
 * The framework's generous default guards, the base tier every override folds onto.
 */
export const DEFAULT_QUERY_GUARDS: Readonly<QueryGuards> = {
  maxConditions: 100,
  maxHasDepth: 8,
  maxInLength: 2000,
  maxBoundParams: 10000,
  maxSelect: 200,
  maxOrder: 10,
  maxPopulate: 20,
  maxPopulateDepth: 2,
  maxValueBytes: 4096,
  maxPatternBytes: 512,
  maxLimit: 2000,
  maxPerPage: 500,
};

/**
 * Folds the guard tiers per key: the defaults, then `config.query.guards`, then `overrides`.
 *
 * `maxBoundParams` is then clamped to the dialect's own limit, so no tier can raise it past the driver.
 * The wire always refuses before the read reaches the driver's wall.
 * Only the untrusted wire path resolves through this; the fluent path is trusted and never guard-checked.
 */
export function resolveGuards(overrides: Partial<QueryGuards> = {}): QueryGuards {
  const resolved = { ...DEFAULT_QUERY_GUARDS, ...useConfig().query?.guards, ...overrides };
  const wall = tryUseDialect()?.maxParameters;
  if (!isUndefined(wall)) resolved.maxBoundParams = Math.min(resolved.maxBoundParams, wall);
  return resolved;
}
