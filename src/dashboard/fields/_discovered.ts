import { isNull } from '../../utils/is/is-null.ts';
import { isUndefined } from '../../utils/is/is-undefined.ts';
import { currentSession } from '../runtime/_request.ts';
import { dashboardMeta } from '../runtime/meta.ts';

/**
 * Whether a field may build: without a session, or with the discovery read answered.
 * A relation or media control resolves its target once, at build, so building earlier would strand it.
 * The read is reactive, so a region gated on it builds when `GET /dashboard` answers.
 */
export function discovered(): boolean {
  return isNull(currentSession()) || !isUndefined(dashboardMeta());
}
