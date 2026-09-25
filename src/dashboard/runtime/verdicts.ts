import type {
  RowVerdicts,
  RowVerdictsAnswer,
  VerdictCounts,
  VerdictTotalsAnswer,
} from './_verdicts.ts';
import type { DashboardCollection } from './meta-types.ts';

import { isUndefined } from '../../utils/is/is-undefined.ts';
import { asksVerdicts, capabilityVerdicts, foldCounts, foldVerdicts } from './_verdicts.ts';
import { api } from './api.ts';

export type { RowVerdicts, VerdictCounts };

/**
 * Resolves which of the rows `UUIDs` names the signed-in user may update and delete.
 * An operation's `access` scope can refuse a row its capability allows, and only the server knows.
 * `locale` is the content locale the update and the translation delete address; omitted is the default.
 * Nothing is asked when no allowed operation is `scoped` or `UUIDs` is empty: the capabilities answer.
 * A failed request falls back to the capabilities too, and the server still enforces every write.
 *
 * @example
 * ```ts
 * const verdicts = await loadVerdicts(collection, [uuid], 'de')
 * verdicts.update.has(uuid) // -> whether the row opens for editing
 * ```
 */
export async function loadVerdicts(
  collection: DashboardCollection,
  UUIDs: readonly string[],
  locale?: string,
): Promise<RowVerdicts> {
  if (UUIDs.length === 0 || !asksVerdicts(collection)) return capabilityVerdicts(collection, UUIDs);
  const answer = await ask<RowVerdictsAnswer>(collection.segment, { UUIDs, locale });
  return isUndefined(answer)
    ? capabilityVerdicts(collection, UUIDs)
    : foldVerdicts(answer, collection);
}

/**
 * Counts the rows the list read's wire `where` describes that the user may update and delete.
 * An omitted `where` describes every row the read lists; `locale` reads as in `loadVerdicts`.
 * Nothing is asked when no allowed operation is `scoped`.
 * That and a failed request resolve `undefined`: an allowed operation then counts the readable total.
 *
 * @example
 * ```ts
 * const counts = await countVerdicts(collection, { status: 'draft' })
 * const deletable = counts?.delete ?? page.total
 * ```
 */
export async function countVerdicts(
  collection: DashboardCollection,
  where: unknown,
  locale?: string,
): Promise<VerdictCounts | undefined> {
  if (!asksVerdicts(collection)) return undefined;
  const answer = await ask<VerdictTotalsAnswer>(collection.segment, { where, locale });
  return isUndefined(answer) ? undefined : foldCounts(answer, collection);
}

/**
 * Posts one question to `POST /collections/[segment]/verdicts`; a failure resolves `undefined`.
 * `JSON.stringify` drops an `undefined` member, so an omitted `where` or `locale` stays off the wire.
 */
async function ask<T>(segment: string, body: Record<string, unknown>): Promise<T | undefined> {
  try {
    const response = await api(`POST /collections/${segment}/verdicts`, {
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!response.ok) return undefined;
    return (await response.json()) as T;
  } catch {
    return undefined;
  }
}
