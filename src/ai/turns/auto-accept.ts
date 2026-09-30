import type { User } from 'ohnejs/auth';

import { queryUntyped } from 'ohnejs';
import { isEmpty, isUndefined } from 'ohnejs/utils';

import type { AIAskKind, AIFields } from '../config.ts';
import type { BatchProposal, TurnBatch } from './state.ts';

import { queryLocales } from '../../ohne/query/locale.ts';
import { useAIConfig } from '../config.ts';

/**
 * Whether `ai.autoAccept` lets any write run without asking.
 * It does once a model plans, `max` is above zero, and `fields` lists a collection.
 * Otherwise the account setting does nothing, and the account page leaves it out.
 */
export function autoAcceptOffered(): boolean {
  const { model, autoAccept } = useAIConfig();
  return !isUndefined(model) && autoAccept.max > 0 && !isEmpty(Object.keys(autoAccept.fields));
}

/**
 * Whether writes of `user` may run without asking: `autoAcceptOffered`, and their account setting is on.
 * The setting is read from their `Users` row, since the session user does not carry it.
 * Valid only where a query may run.
 */
export async function autoAccepts(user: User): Promise<boolean> {
  if (!autoAcceptOffered()) return false;
  const record = await queryUntyped('Users')
    .where({ UUID: user.UUID })
    .select('autoAccept')
    .findFirst();
  return record?.autoAccept === true;
}

/**
 * The kinds of write `proposal` is, as `ai.autoAccept.ask` names them.
 * A write at the default locale named explicitly is no `locale` write.
 *
 * @example
 * ```ts
 * askKinds({ proposal: { route: 'DELETE /collections/items/[uuid]', tier: 'destructive' } })
 * // -> ['destructive']
 * ```
 */
export function askKinds({ proposal }: Pick<BatchProposal, 'proposal'>): AIAskKind[] {
  const kinds: AIAskKind[] = [];
  if (proposal.tier === 'destructive') kinds.push('destructive');
  if (!isUndefined(proposal.where)) kinds.push('set');
  const locale = proposal.query?.locale;
  if (!isUndefined(locale) && locale !== queryLocales().defaultLocale) kinds.push('locale');
  if (!isUndefined(proposal.transform)) kinds.push('transform');
  return kinds;
}

/**
 * Tags every write of `batch` `auto` when all of them may run without asking, so the browser sends it so.
 * A write may when `ai.autoAccept.fields` lists its collection and every key of its body.
 * It may not when its kind is one `ai.autoAccept.ask` names.
 * A write by set never may, whatever `ask` names, since its size is unknown until the browser expands it.
 * Nor may a transform, since the person reviews what the model wrote.
 * The batch runs unasked only while its writes and those tagged in `earlier` batches stay within `max`.
 * Otherwise the batch asks as a whole, and nothing is tagged.
 * `on` is whether the person's writes may run unasked at all, as `autoAccepts` answers it.
 */
export function tagAutoAccept(batch: TurnBatch, earlier: readonly TurnBatch[], on: boolean): void {
  if (!on) return;
  const { max, fields, ask } = useAIConfig().autoAccept;
  const writes = batch.proposals.filter((entry) => entry.proposal.tier !== 'read');
  if (isEmpty(writes) || !writes.every((entry) => runsUnasked(entry, fields, ask))) return;
  const ran = earlier.flatMap((entry) => entry.proposals).filter((entry) => entry.proposal.auto);
  if (ran.length + writes.length > max) return;
  for (const entry of writes) entry.proposal.auto = true;
}

/**
 * Whether one write may run without asking, by its route, its kinds and its body's keys.
 * Only a record write or a body-less one qualifies: an app route or a translation copy always asks.
 */
function runsUnasked(entry: BatchProposal, fields: AIFields, ask: readonly AIAskKind[]): boolean {
  const { route, proposal } = entry;
  if (!isUndefined(proposal.where) || !isUndefined(proposal.transform)) return false;
  if (route.body !== 'record' && route.body !== 'none') return false;
  if (askKinds(entry).some((kind) => ask.includes(kind))) return false;
  const listed = isUndefined(route.collection)
    ? undefined
    : (fields as Record<string, true | string[] | undefined>)[route.collection];
  if (isUndefined(listed)) return false;
  return listed === true || Object.keys(proposal.body ?? {}).every((key) => listed.includes(key));
}
