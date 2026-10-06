/**
 * A link to a record, which follows the record wherever it lives.
 * `C` narrows the collections a link may point into.
 */
export interface RecordLink<C extends string = string> {
  /**
   * The collection that holds the target record.
   */
  collection: C;

  /**
   * The target record's `UUID`.
   */
  record: string;

  /**
   * A fragment on the target's page, without the leading `#`.
   */
  hash?: string;

  /**
   * Whether the link opens in a new tab.
   *
   * @default
   * false
   */
  newTab?: boolean;

  /**
   * The target's path for the current reader, set when the link is resolved for reading.
   * `normalizeLink` drops it, so a link read and written back never stores it.
   */
  href?: string;
}

/**
 * A link to an address: a web, email or phone address, a local `/path` or a `#fragment`.
 */
export interface URLLink {
  /**
   * The address the link opens.
   */
  url: string;

  /**
   * Whether the link opens in a new tab.
   *
   * @default
   * false
   */
  newTab?: boolean;
}

/**
 * A link to a record or to an address.
 * A `collection` key makes it a `RecordLink`, and a `url` key a `URLLink`.
 *
 * @example
 * ```ts
 * const page: Link = { collection: 'Pages', record: '019f3c1a-8b2d-7f4e-9a6b-1c2d3e4f5a6b' }
 * const site: Link = { url: 'https://example.com', newTab: true }
 * ```
 */
export type Link<C extends string = string> = RecordLink<C> | URLLink;
