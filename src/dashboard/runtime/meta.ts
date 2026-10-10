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

/**
 * Reads the dashboard's discovery data, `undefined` until `GET /dashboard` answers.
 * The first read under a session fetches once; every read is reactive, so bindings render when it arrives.
 * Without a session it stays `undefined` and fetches nothing, since the route answers only a signed-in user.
 * Signing in and out invalidates the store, so it always describes the current user.
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
 * Empties the store and wakes every reader, so the next `dashboardMeta` read fetches fresh discovery data.
 * An in-flight fetch from before the invalidation is discarded when it answers.
 * Call it after changing what the user may see: a role edit, a collection change, a new session.
 */
export function invalidateDashboardMeta(): void {
  meta.value = undefined;
  generation.value += 1;
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
