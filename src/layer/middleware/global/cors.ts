import {
  cors,
  DEFAULT_DASHBOARD_PORT,
  defineMiddleware,
  type Middleware,
  useConfig,
  useEnv,
} from 'ohne';

let middleware: Middleware | null = null;

/**
 * Allows the dashboard origin to make credentialed cross-origin requests to the API.
 * The session cookie then flows between the two servers, so login works from the browser.
 * The origin comes from the `DASHBOARD_URL` env, then `dashboard.origin`, then `dashboard.port`.
 * Any other origin gets no CORS headers, replacing the API's open credential-free default.
 * Shadow this file in a closer layer to change the policy.
 *
 * The policy is built on the first request, once the layer stack has resolved the config.
 */
export default defineMiddleware((event) => {
  middleware ??= cors({ origin: dashboardOrigin(), credentials: true });
  return middleware(event);
});

/**
 * The origin the browser reaches the dashboard at: env, then config, then the derived default.
 */
function dashboardOrigin(): string {
  const dashboard = useConfig().dashboard;
  return (
    useEnv().get('DASHBOARD_URL') ??
    dashboard?.origin ??
    `http://localhost:${dashboard?.port ?? DEFAULT_DASHBOARD_PORT}`
  );
}
