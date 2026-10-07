import type { Link, RecordLink, URLLink } from '../../utils/rich-text/link.ts';
import type { DashboardCollection } from '../runtime/meta-types.ts';

import { isSafeHref } from '../../utils/html/is-safe-href.ts';
import { isString } from '../../utils/is/is-string.ts';
import { isUndefined } from '../../utils/is/is-undefined.ts';
import { normalizeLink } from '../../utils/rich-text/normalize-link.ts';
import { recordHref } from '../../utils/route/record-href.ts';
import { typedHref } from '../../utils/uri/typed-href.ts';
import { isUUID } from '../../utils/uuid/is-uuid.ts';

/**
 * The record a link points at, without its options.
 */
export type RecordTarget = Pick<RecordLink, 'collection' | 'record'>;

/**
 * What a link points at, without its options: a record, or an address.
 */
export type LinkTarget = RecordTarget | Pick<URLLink, 'url'>;

/**
 * The slice of a described collection a dashboard record URL is matched against.
 */
export type RecordURLCollection = Pick<DashboardCollection, 'name' | 'segment' | 'recordPath'>;

/**
 * A search keyword read as a link target.
 */
export interface KeywordTarget {
  /**
   * The record a dashboard record URL opens, or the address the keyword reads as.
   */
  target: LinkTarget;

  /**
   * Whether the target may become a link: always for a record, and for an address that passes `isSafeHref`.
   */
  safe: boolean;
}

/**
 * The options a link carries besides its target.
 */
export interface LinkTargetOptions {
  /**
   * The fragment on a record's page, with or without its leading `#`.
   * An address ignores it.
   */
  hash?: string;

  /**
   * Whether the link opens in a new tab.
   *
   * @default
   * false
   */
  newTab?: boolean;
}

const RECORD_VALUE = /^record:([^:]+):(.+)$/;
const URL_VALUE = 'url:';

/**
 * The `dynamicSelect` value of a link target, unique across collections and addresses.
 * `linkTargetOf` reads it back.
 */
export function linkChoiceValue(target: LinkTarget): string {
  return 'url' in target
    ? `${URL_VALUE}${target.url}`
    : `record:${target.collection}:${target.record}`;
}

/**
 * Reads a `dynamicSelect` value back as the link target `linkChoiceValue` encoded.
 * Anything else reads as `undefined`.
 */
export function linkTargetOf(value: unknown): LinkTarget | undefined {
  if (!isString(value)) return undefined;
  if (value.startsWith(URL_VALUE)) return { url: value.slice(URL_VALUE.length) };
  const match = RECORD_VALUE.exec(value);
  return match ? { collection: match[1]!, record: match[2]! } : undefined;
}

/**
 * The keyword a target select opens its search with: the address of an address value, else `''`.
 * An address can then be edited in place instead of typed again.
 */
export function choiceKeyword(value: unknown): string {
  const target = linkTargetOf(value);
  return !isUndefined(target) && 'url' in target ? target.url : '';
}

/**
 * The record a dashboard URL opens, when `value` is an absolute URL on `origin` that opens a record.
 * A record opens at its collection's `recordHref`; extra query parameters such as `locale` are ignored.
 * Only `collections` are matched, so a URL into any other collection reads as `undefined`.
 */
export function dashboardRecordTarget(
  value: string,
  collections: readonly RecordURLCollection[],
  origin: string,
): RecordTarget | undefined {
  const url = URL.parse(value.trim());
  if (url?.origin !== origin) return undefined;
  const candidates = [...url.pathname.split('/'), ...url.searchParams.values()].filter(isUUID);
  for (const collection of collections) {
    for (const uuid of candidates) {
      const opens = new URL(recordHref(collection, uuid), origin);
      const query = [...opens.searchParams];
      if (
        opens.pathname === url.pathname &&
        query.every(([key, expected]) => url.searchParams.get(key) === expected)
      ) {
        return { collection: collection.name, record: uuid };
      }
    }
  }
  return undefined;
}

/**
 * Reads a search keyword as a link target, or `undefined` when it should search records instead.
 * A dashboard record URL reads as its record, and anything `typedHref` reads as an address reads as that.
 */
export function readLinkKeyword(
  keyword: string,
  collections: readonly RecordURLCollection[],
  origin: string,
): KeywordTarget | undefined {
  const record = dashboardRecordTarget(keyword, collections, origin);
  if (!isUndefined(record)) return { target: record, safe: true };
  const url = typedHref(keyword);
  return isUndefined(url) ? undefined : { target: { url }, safe: isSafeHref(url) };
}

/**
 * The canonical link to `target` with `options`, as `normalizeLink` stores it.
 */
export function linkOf(target: LinkTarget, options: LinkTargetOptions = {}): Link {
  const newTab = options.newTab === true ? { newTab: true } : {};
  if ('url' in target) return normalizeLink({ url: target.url, ...newTab });
  const hash = isUndefined(options.hash) ? {} : { hash: options.hash };
  return normalizeLink({
    collection: target.collection,
    record: target.record,
    ...hash,
    ...newTab,
  });
}
