import { isBusyError, queryUntyped, useConfig } from 'ohnejs';
import { isEmpty, parseDuration } from 'ohnejs/utils';

import { useAIConfig } from '../config.ts';

/**
 * The most turns one prune deletes.
 */
const PRUNE_BATCH = 1000;

/**
 * How long a prune waits for the next, once no backlog remains.
 */
const PRUNE_INTERVAL = 60_000;

/**
 * When the next prune is due, per resolved config.
 */
const due = new WeakMap<object, number>();

/**
 * Deletes the turns that closed longer than `ai.audit.retain` before `now`, and resolves how many.
 * An open turn left quiet counts as closed from the moment a touch would have closed it.
 * It runs at most once a minute per process and config, one batch at a time.
 * A full batch leaves the next prune due at once, so a backlog drains turn by turn.
 * A busy database skips the prune until the next is due.
 * `ai.audit.retain: false` keeps every turn.
 */
export async function pruneTurns(now = Date.now()): Promise<number> {
  const { audit, limits } = useAIConfig();
  const config = useConfig();
  if (audit.retain === false || now < (due.get(config) ?? 0)) return 0;
  due.set(config, now + PRUNE_INTERVAL);
  const cutoff = now - parseDuration(audit.retain);
  const quiet = Math.max(parseDuration(limits.turnTimeout), parseDuration(limits.step) * 2);
  try {
    const uuids = (await queryUntyped('AITurns')
      .unscoped()
      .where({
        or: [
          { closedAt: { lessThan: cutoff } },
          { closedAt: { isNull: true }, _updatedAt: { lessThan: cutoff - quiet } },
        ],
      })
      .limit(PRUNE_BATCH)
      .pluck('UUID')) as string[];
    if (isEmpty(uuids)) return 0;
    const { deleted } = await queryUntyped('AITurns')
      .unscoped()
      .where({ UUID: { in: uuids } })
      .delete();
    if (uuids.length === PRUNE_BATCH) due.set(config, now);
    return deleted;
  } catch (error) {
    if (!isBusyError(error)) throw error;
    return 0;
  }
}
