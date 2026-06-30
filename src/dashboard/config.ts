import type { PageRoute } from '../utils/route/page-route.ts';

import { isUndefined } from '../utils/is/is-undefined.ts';

/**
 * The configuration the dashboard server injects into the shell.
 */
export interface DashboardConfig {
  /**
   * Base URL of the API the dashboard talks to.
   */
  apiURL: string;

  /**
   * The page route manifest, ordered most-specific-first.
   */
  pages: PageRoute[];
}

let cached: DashboardConfig | undefined;

/**
 * Reads the configuration from the shell's `#ohne-config` blob, parsed once and cached.
 */
export function dashboardConfig(): DashboardConfig {
  if (isUndefined(cached)) {
    cached = JSON.parse(
      document.getElementById('ohne-config')?.textContent ?? '{}',
    ) as DashboardConfig;
  }
  return cached;
}
