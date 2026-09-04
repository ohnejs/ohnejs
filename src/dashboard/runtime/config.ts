import type { PageRoute } from '../../utils/route/page-route.ts';
import type { DashboardLanguage } from './use-dashboard-language.ts';

import { isUndefined } from '../../utils/is/is-undefined.ts';

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

  /**
   * Served URLs of every layer's dashboard boot files, in run order.
   * The kernel imports each in turn before the router starts.
   */
  boot: string[];

  /**
   * Default message language, a canonical BCP-47 tag.
   * `useDashboardLanguage` starts here, and the messages endpoint falls back to it.
   * Narrows to the generated language union once codegen has run.
   */
  defaultLanguage: DashboardLanguage;
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
