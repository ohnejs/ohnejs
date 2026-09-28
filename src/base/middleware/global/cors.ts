import {
  cors,
  DEFAULT_DASHBOARD_PORT,
  defineMiddleware,
  type Middleware,
  useConfig,
  useEnv,
} from 'ohnejs';
import { listenOrigin } from 'ohnejs/utils/net';

let middleware: Middleware | null = null;

/**
 * Allows the dashboard origin to make credentialed cross-origin requests to the API.
 * The session cookie then flows between the two servers, so login works from the browser.
 * The origin comes from the `DASHBOARD_URL` env, then `dashboard.origin`, then `dashboard.host` and `port`.
 * Any other origin gets no CORS headers, replacing the API's open credential-free default.
 * Its credentialed origins are also the only cross-origin pages whose session cookie may change anything.
 * Shadow this file in a closer layer to change the policy.
 *
 * The policy is built on the first request, once the layer stack has resolved the config.
 */
export default defineMiddleware((event) => {
  middleware ??= cors({
    origin: dashboardOrigin(),
    credentials: true,
    exposeHeaders: ['Retry-After'],
  });
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
    listenOrigin(useEnv().get('HOST') ?? dashboard?.host, dashboard?.port ?? DEFAULT_DASHBOARD_PORT)
  );
}
