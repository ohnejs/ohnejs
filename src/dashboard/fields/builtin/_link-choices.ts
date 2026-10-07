import type { RecordLink } from '../../../utils/rich-text/link.ts';
import type { DashboardCollection } from '../../runtime/meta-types.ts';
import type { Primitive } from '../../ui/button-group.ts';
import type {
  DynamicSelectChoice,
  DynamicSelectPaginatedChoices,
} from '../../ui/dynamic-select.ts';
import type { KeywordTarget, LinkTarget, RecordTarget } from '../_link-model.ts';
import type { RecordChoiceSource } from './record.ts';

import { isSafeHref } from '../../../utils/html/is-safe-href.ts';
import { isBoolean } from '../../../utils/is/is-boolean.ts';
import { isNull } from '../../../utils/is/is-null.ts';
import { isUndefined } from '../../../utils/is/is-undefined.ts';
import { getOrSet } from '../../../utils/map/get-or-set.ts';
import { ref } from '../../../utils/reactive/ref.ts';
import { untracked } from '../../../utils/reactive/untracked.ts';
import { recordHref } from '../../../utils/route/record-href.ts';
import { useT } from '../../runtime/use-t.ts';
import {
  dashboardRecordTarget,
  linkChoiceValue,
  linkTargetOf,
  readLinkKeyword,
} from '../_link-model.ts';
import { readableCollection } from '../_search.ts';
import { notFoundLabel, recordChoiceSource } from './record.ts';

/**
 * The target choices of a link: records across every collection a link may point into, and addresses.
 * Choice values are `linkChoiceValue`s, so `linkTargetOf` reads a picked one back.
 */
export interface LinkChoices {
  /**
   * The collections whose records the choices search: those the field allows and the user can read.
   */
  collections: readonly DashboardCollection[];

  /**
   * Resolves one page of choices for a `dynamicSelect`.
   * A keyword that reads as an address or as a dashboard record URL resolves that one choice instead.
   * An address that fails `isSafeHref` resolves as a disabled choice that says so.
   */
  choicesResolver(page: number, keyword: string): Promise<DynamicSelectPaginatedChoices>;

  /**
   * Resolves the choice of a selected value.
   * A deleted or unreadable record resolves a "record not found" choice.
   */
  selectedChoiceResolver(value: Primitive): Promise<DynamicSelectChoice | null>;

  /**
   * Whether a record link's target is missing: deleted, hidden, or in a collection the user cannot read.
   * A reactive read: it answers `false` until a batched check settles, and a failed check stays `false`.
   */
  missing(link: RecordTarget): boolean;

  /**
   * Reads a dashboard record URL on this origin as the link to its record, when its collection is allowed.
   */
  record(url: string): RecordLink | undefined;
}

interface Source {
  collection: DashboardCollection;
  source: RecordChoiceSource;
}

/**
 * Creates the target choices for a field's `links` option, or for a `link` field's `collections`.
 * Every allowed collection is asked for the same page in parallel, and the pages join in declared order.
 * The joined pages last as long as the longest collection's.
 * Each choice names its collection when several are searched.
 * Record labels resolve through one `recordChoiceSource` per collection, whose cache every read shares.
 */
export function linkChoices(links: boolean | readonly string[] = true): LinkChoices {
  const t = useT();
  const sources = new Map<string, Source | null>();
  const dead = ref<ReadonlySet<string>>(new Set());
  const asked = new Set<string>();
  const queued = new Map<string, Set<string>>();

  const sourceOf = (name: string): Source | undefined =>
    getOrSet(sources, name, () => {
      const collection = untracked(() => readableCollection(name));
      return isUndefined(collection)
        ? null
        : { collection, source: recordChoiceSource(collection) };
    }) ?? undefined;

  const searched = (isBoolean(links) ? [] : links).flatMap((name) => sourceOf(name) ?? []);
  const collections = searched.map((entry) => entry.collection);
  const detailed = collections.length > 1;

  const recordChoice = (
    collection: DashboardCollection,
    choice: DynamicSelectChoice,
  ): DynamicSelectChoice => ({
    value: linkChoiceValue({ collection: collection.name, record: String(choice.value) }),
    label: choice.label,
    ...(detailed ? { detail: collection.label } : {}),
  });

  const keywordChoice = async ({ target, safe }: KeywordTarget): Promise<DynamicSelectChoice> => {
    if ('url' in target) {
      const detail = t(safe ? 'dashboard.link.useURL' : 'dashboard.link.unsafeURL');
      return { value: linkChoiceValue(target), label: target.url, detail, disabled: !safe };
    }
    const { collection, source } = sourceOf(target.collection)!;
    return recordChoice(collection, await source.choiceOf(target.record));
  };

  const bury = (collection: string, records: Iterable<string>): void => {
    const keys = [...records].map((record) => linkChoiceValue({ collection, record }));
    if (keys.length > 0) dead.value = new Set([...untracked(() => dead.value), ...keys]);
  };

  const check = (): void => {
    for (const [collection, records] of queued) {
      const entry = sourceOf(collection);
      if (isUndefined(entry)) bury(collection, records);
      else void entry.source.missing([...records]).then((found) => bury(collection, found));
    }
    queued.clear();
  };

  return {
    collections,
    async choicesResolver(page, keyword) {
      const read = readLinkKeyword(keyword, collections, location.origin);
      if (!isUndefined(read)) {
        return {
          choices: [await keywordChoice(read)],
          currentPage: 1,
          lastPage: 1,
          perPage: 1,
          total: 1,
        };
      }
      const pages = await Promise.all(
        searched.map((entry) => entry.source.choicesResolver(page, keyword)),
      );
      return {
        choices: pages.flatMap((result, index) =>
          result.choices.map((choice) => recordChoice(searched[index]!.collection, choice)),
        ),
        currentPage: page,
        lastPage: Math.max(1, ...pages.map((result) => result.lastPage)),
        perPage: pages.reduce((sum, result) => sum + result.perPage, 0),
        total: pages.reduce((sum, result) => sum + result.total, 0),
      };
    },
    async selectedChoiceResolver(value) {
      const target = linkTargetOf(value);
      if (isUndefined(target)) return null;
      if ('url' in target) {
        return {
          value,
          label: target.url,
          ...(detailed ? { detail: t('dashboard.link.external') } : {}),
        };
      }
      const entry = sourceOf(target.collection);
      if (isUndefined(entry)) return { value, label: notFoundLabel(target.record) };
      const choice = await entry.source.choiceOf(target.record);
      return { ...recordChoice(entry.collection, choice), value };
    },
    missing(link) {
      const key = linkChoiceValue(link);
      if (!asked.has(key)) {
        asked.add(key);
        if (queued.size === 0) queueMicrotask(check);
        getOrSet(queued, link.collection, () => new Set<string>()).add(link.record);
      }
      return dead.value.has(key);
    },
    record(url) {
      return dashboardRecordTarget(url, collections, location.origin);
    },
  };
}

/**
 * Where the dashboard opens a link target in a new tab: the record's dashboard page, or the address.
 * A relative address belongs to the website, not the dashboard, so it opens nowhere, as does an unsafe one.
 * A record opens nowhere when the user cannot read its collection.
 */
export function targetHref(target: LinkTarget): string | undefined {
  if ('url' in target) {
    return isSafeHref(target.url) && !isNull(URL.parse(target.url)) ? target.url : undefined;
  }
  const collection = readableCollection(target.collection);
  return isUndefined(collection) ? undefined : recordHref(collection, target.record);
}
