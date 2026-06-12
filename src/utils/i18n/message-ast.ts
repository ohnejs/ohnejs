/**
 * Parsed ICU MessageFormat template.
 * An ordered sequence of nodes.
 * Bodies of `plural` / `select` cases are themselves `MessageAST`, so recursion is uniform.
 */
export type MessageAST = readonly MessageNode[];

/**
 * Any node in a `MessageAST`.
 * Discriminated by `kind`.
 * Styles for `number` / `date` / `time` are carried as raw strings.
 * The formatter decodes ICU skeletons at render time.
 */
export type MessageNode =
  | MessageLiteralNode
  | MessageArgumentNode
  | MessageNumberNode
  | MessageDateNode
  | MessageTimeNode
  | MessagePluralNode
  | MessageSelectNode
  | MessagePoundNode;

/**
 * Raw text between arguments.
 * ICU escapes (`''`, quoted spans) are already resolved by the parser,
 * so renderers can emit `value` verbatim.
 */
export interface MessageLiteralNode {
  /**
   * Discriminant.
   */
  readonly kind: 'literal';

  /**
   * The text to emit. Already escape-resolved.
   */
  readonly value: string;
}

/**
 * Simple placeholder: `{name}`.
 * Renders the value of `params[name]` coerced to string.
 * Missing params default to re-emitting `{name}` so the gap is visible to the caller.
 */
export interface MessageArgumentNode {
  /**
   * Discriminant.
   */
  readonly kind: 'argument';

  /**
   * Argument name as written. Numeric names (`{0}`) are kept as their
   * string form so positional and named arguments share one lookup path.
   */
  readonly name: string;
}

/**
 * Typed placeholder: `{n, number}` / `{n, number, integer}` /
 * `{n, number, ::currency/EUR .00}`.
 */
export interface MessageNumberNode {
  /**
   * Discriminant.
   */
  readonly kind: 'number';

  /**
   * Argument name as written.
   */
  readonly name: string;

  /**
   * The argStyle text, trimmed, with `::` skeleton prefix preserved.
   * `null` when no style was given (`{n, number}`).
   */
  readonly style: string | null;
}

/**
 * Typed placeholder: `{d, date}` / `{d, date, short}` / `{d, date, ::yMMMd}`.
 */
export interface MessageDateNode {
  /**
   * Discriminant.
   */
  readonly kind: 'date';

  /**
   * Argument name as written.
   */
  readonly name: string;

  /**
   * The argStyle text, trimmed. `null` when none was given.
   */
  readonly style: string | null;
}

/**
 * Typed placeholder: `{d, time}` / `{d, time, short}`.
 */
export interface MessageTimeNode {
  /**
   * Discriminant.
   */
  readonly kind: 'time';

  /**
   * Argument name as written.
   */
  readonly name: string;

  /**
   * The argStyle text, trimmed. `null` when none was given.
   */
  readonly style: string | null;
}

/**
 * Plural or selectordinal placeholder.
 * `ordinal` selects between `Intl.PluralRules({ type: 'cardinal' })`
 * and `'ordinal'` at format time.
 *
 * Per ICU: `offset` is subtracted from the input number before both
 * category selection AND `#` substitution; `exact` (`=N`) matches are
 * checked against the raw input and always win over keyword matches.
 */
export interface MessagePluralNode {
  /**
   * Discriminant.
   */
  readonly kind: 'plural';

  /**
   * Argument name.
   */
  readonly name: string;

  /**
   * `true` for `selectordinal`, `false` for `plural`.
   */
  readonly ordinal: boolean;

  /**
   * `offset:N` value. `0` when omitted.
   */
  readonly offset: number;

  /**
   * Ordered case arms.
   */
  readonly cases: readonly MessagePluralCase[];
}

/**
 * One arm of a `plural` or `selectordinal`.
 * `exact` is the parsed `=N` value when the key is `=N`; `null` for
 * keyword cases (`one`, `other`, ...).
 */
export interface MessagePluralCase {
  /**
   * `'=N'` (with the leading `=`) for exact cases, otherwise the
   * keyword (`'one'`, `'other'`, ...).
   */
  readonly keyword: string;

  /**
   * Parsed numeric value of an `=N` key, or `null` for keyword cases.
   */
  readonly exact: number | null;

  /**
   * Body of this arm. Resolves with the enclosing plural value bound
   * to `#`.
   */
  readonly body: MessageAST;
}

/**
 * Select placeholder: `{role, select, admin {...} other {...}}`.
 * String-keyed lookup against `params[name]`; falls back to `other`.
 */
export interface MessageSelectNode {
  /**
   * Discriminant.
   */
  readonly kind: 'select';

  /**
   * Argument name.
   */
  readonly name: string;

  /**
   * Ordered case arms. `other` must be present (the parser enforces it).
   */
  readonly cases: readonly MessageSelectCase[];
}

/**
 * One arm of a `select`.
 */
export interface MessageSelectCase {
  /**
   * Keyword matched against the string value of the argument.
   */
  readonly keyword: string;

  /**
   * Body of this arm.
   */
  readonly body: MessageAST;
}

/**
 * `#` substitution inside a `plural` / `selectordinal` body.
 * Resolves to the enclosing plural's value minus its offset, formatted
 * via `Intl.NumberFormat` for the active language.
 */
export interface MessagePoundNode {
  /**
   * Discriminant.
   */
  readonly kind: 'pound';
}
