import { DEFAULT_DASHBOARD_PORT, useConfig, useEnv } from 'ohnejs';
import { listenOrigin } from 'ohnejs/utils/net';

/**
 * The origin the browser reaches the dashboard at: env, then config, then the derived default.
 * The `DASHBOARD_URL` env wins, then `dashboard.origin`, then `dashboard.host` and `port`.
 *
 * @example
 * ```ts
 * dashboardOrigin() // -> 'http://localhost:9000'
 * ```
 */
export function dashboardOrigin(): string {
  const dashboard = useConfig().dashboard;
  return (
    useEnv().get('DASHBOARD_URL') ??
    dashboard?.origin ??
    listenOrigin(useEnv().get('HOST') ?? dashboard?.host, dashboard?.port ?? DEFAULT_DASHBOARD_PORT)
  );
}
