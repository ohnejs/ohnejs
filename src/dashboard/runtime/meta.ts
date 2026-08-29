import type {
  DashboardBlock,
  DashboardCollection,
  DashboardField,
  DashboardMenuGroup,
  DashboardMeta,
  DashboardOperation,
  DashboardOperations,
} from './meta-types.ts';

import { ref } from '../../utils/reactive/ref.ts';
import { api } from './api.ts';

export type {
  DashboardBlock,
  DashboardCollection,
  DashboardField,
  DashboardMenuGroup,
  DashboardMeta,
  DashboardOperation,
  DashboardOperations,
};

const meta = ref<DashboardMeta | undefined>(undefined);
let requested = false;
let generation = 0;

/**
 * Reads the dashboard's discovery data, `undefined` until `GET /dashboard` answers.
 * The first read fetches once; every read is reactive, so bindings render when it arrives.
 * Read it only under a signed-in session: a `401` leaves it `undefined` for the session.
 * Login and logout invalidate the store, so it always describes the current user.
 *
 * @example
 * ```ts
 * each(() => dashboardMeta()?.collections ?? [], (entry) => entry.name, renderLink)
 * ```
 */
export function dashboardMeta(): DashboardMeta | undefined {
  if (!requested) {
    requested = true;
    void load();
  }
  return meta.value;
}

/**
 * Empties the store, so the next `dashboardMeta` read fetches fresh discovery data.
 * An in-flight fetch from before the invalidation is discarded when it answers.
 * Call it after changing what the user may see: a role edit, a collection change, a new session.
 */
export function invalidateDashboardMeta(): void {
  generation += 1;
  requested = false;
  meta.value = undefined;
}

/**
 * Loads the discovery data once; a failed or superseded response leaves the store untouched.
 */
async function load(): Promise<void> {
  const mine = generation;
  try {
    const response = await api('GET /dashboard');
    if (response.ok && generation === mine) meta.value = (await response.json()) as DashboardMeta;
  } catch {
    /* the shell's session guard owns the failure surface */
  }
}
