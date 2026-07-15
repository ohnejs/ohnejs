import { ohneError } from '../../error/ohne-error.ts';
import { useConfig } from '../../layers/use-config.ts';

/**
 * The DoS guards that bound a wire-driven query, resolved per key from three tiers.
 *
 * Framework defaults, then `config.query.guards` app-wide, then `.guards()` per builder.
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
   * The most bound parameters one compiled statement may carry, the driver's variable limit's backstop.
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
   * The largest page a paginated endpoint may serve.
   *
   * @default
   * 500
   */
  maxPerPage: number;
}

/**
 * The framework's generous default guards, the base tier the config and the builder override onto.
 */
export const DEFAULT_QUERY_GUARDS: Readonly<QueryGuards> = {
  maxConditions: 100,
  maxHasDepth: 8,
  maxInLength: 2000,
  maxBoundParams: 10000,
  maxSelect: 200,
  maxOrder: 10,
  maxValueBytes: 4096,
  maxPatternBytes: 512,
  maxPerPage: 500,
};

/**
 * Folds the three guard tiers into one effective table: defaults, then config, then the builder.
 *
 * The framework defaults are the base; `config.query.guards` overrides them app-wide.
 * A builder's own `.guards()` overrides win last, per key.
 * Only the untrusted wire path resolves through this; the fluent path is trusted and never guard-checked.
 */
export function resolveGuards(overrides: Partial<QueryGuards> = {}): QueryGuards {
  return { ...DEFAULT_QUERY_GUARDS, ...useConfig().query?.guards, ...overrides };
}

/**
 * Refuses a compiled statement carrying more bound parameters than the framework backstop allows.
 * The driver's own variable limit is the hard wall; this cap sits below it and names the count.
 */
export function assertBoundParams(count: number): void {
  if (count <= DEFAULT_QUERY_GUARDS.maxBoundParams) return;
  throw ohneError({
    title: 'Query exceeds the bound-parameter cap',
    body: [
      `The compiled statement binds ${count} parameters, past the cap of ${DEFAULT_QUERY_GUARDS.maxBoundParams}.`,
      'Narrow the condition, or shrink an `in` list.',
    ],
  });
}
