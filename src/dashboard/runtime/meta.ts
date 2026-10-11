import type {
  DashboardBlock,
  DashboardCollection,
  DashboardField,
  DashboardMenuGroup,
  DashboardMenuItem,
  DashboardMeta,
  DashboardOperation,
  DashboardOperations,
  DashboardTable,
} from './meta-types.ts';

import { isNull } from '../../utils/is/is-null.ts';
import { ref } from '../../utils/reactive/ref.ts';
import { currentSession } from './_request.ts';
import { api } from './api.ts';

export type {
  DashboardBlock,
  DashboardCollection,
  DashboardField,
  DashboardMenuGroup,
  DashboardMenuItem,
  DashboardMeta,
  DashboardOperation,
  DashboardOperations,
  DashboardTable,
};

const meta = ref<DashboardMeta | undefined>(undefined);
const generation = ref(0);
let requested = -1;
let identity = 0;

/**
 * Reads the dashboard's discovery data, `undefined` until `GET /dashboard` answers.
 * The first read under a session fetches once; every read is reactive, so bindings render when it arrives.
 * Without a session it stays `undefined` and fetches nothing, since the route answers only a signed-in user.
 * A new identity empties the store, so it always describes the current user.
 * A refresh keeps the current data until the new answer lands, so a gate on it stays mounted.
 *
 * @example
 * ```ts
 * each(() => dashboardMeta()?.collections ?? [], (entry) => entry.name, renderLink)
 * ```
 */
export function dashboardMeta(): DashboardMeta | undefined {
  const current = generation.value;
  if (isNull(currentSession())) return undefined;
  if (requested !== current) {
    requested = current;
    void load(current);
  }
  return meta.value;
}

/**
 * Refetches the discovery data in place: the current data stays until the answer lands, then is replaced.
 * An in-flight fetch from before the invalidation is discarded when it answers.
 * Call it after changing what the user may see, like a role edit or a collection change.
 */
export function invalidateDashboardMeta(): void {
  generation.value += 1;
}

/**
 * Empties the store and refetches, so no reader sees data that described another identity.
 */
export function resetDashboardMeta(): void {
  meta.value = undefined;
  generation.value += 1;
  identity += 1;
}

/**
 * Counts the identity changes the store has followed, so a cache kept per user knows when to empty.
 * An in-place refresh keeps the count, since it describes the same user.
 */
export function dashboardMetaIdentity(): number {
  return identity;
}

/**
 * Loads the discovery data for one generation; a failed or superseded response leaves the store untouched.
 */
async function load(mine: number): Promise<void> {
  try {
    const response = await api('GET /dashboard');
    if (!response.ok) return;
    const answer = (await response.json()) as DashboardMeta;
    if (generation.value === mine) meta.value = answer;
  } catch {
    /* the shell's session guard owns the failure surface */
  }
}
