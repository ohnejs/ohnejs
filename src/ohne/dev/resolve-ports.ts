import { isUndefined } from '../../utils/index.ts';
import { freePort } from '../../utils/net/index.ts';

/**
 * The ports a dev run binds its two children on.
 */
export interface DevPorts {
  /**
   * Port the dashboard child binds.
   */
  dashboard: number;

  /**
   * Port the API child binds.
   */
  api: number;
}

/**
 * The preferences that decide the dev ports, read from `PORT` and config by the caller.
 */
export interface DevPortInputs {
  /**
   * `PORT` env: the stack base.
   * When set, it seeds the dashboard and the API takes the next port, so both move together.
   * When unset, the dashboard and API resolve independently from their own preferred ports.
   */
  base: number | undefined;

  /**
   * The dashboard's preferred port, used when `base` is unset.
   * The caller passes `Config.dashboard.port`, falling back to the default.
   */
  dashboard: number;

  /**
   * The API's preferred port, used when `base` is unset.
   * The caller passes `Config.api.port`, falling back to the default.
   */
  api: number;

  /**
   * Whether the dashboard child runs.
   * When false, the API takes the base directly and no port is reserved for the dashboard.
   */
  serveDashboard: boolean;
}

/**
 * Resolves the dashboard and API ports for a dev run, scanning past any port already in use.
 *
 * With `base` set, the dashboard takes it and the API takes the next free port, moving the whole stack.
 * Without `base`, each side resolves from its own preferred port.
 * Either way a port already taken is skipped and `onBusy` is called with it, so the caller can warn.
 *
 * The sibling's port is excluded from the API's scan, so the two never collide without a warning.
 * The two scans can overlap, so a busy port is reported to `onBusy` once, not per scan.
 */
export async function resolveDevPorts(
  inputs: DevPortInputs,
  onBusy?: (port: number) => void,
): Promise<DevPorts> {
  const { base, serveDashboard } = inputs;

  const seen = new Set<number>();
  const report = (port: number): void => {
    if (seen.has(port)) return;
    seen.add(port);
    onBusy?.(port);
  };

  const dashboardWant = base ?? inputs.dashboard;
  const dashboard = serveDashboard
    ? await freePort(dashboardWant, { onBusy: report })
    : dashboardWant;

  const apiWant = isUndefined(base) ? inputs.api : serveDashboard ? dashboard + 1 : base;
  const api = await freePort(apiWant, {
    exclude: serveDashboard ? [dashboard] : [],
    onBusy: report,
  });

  return { dashboard, api };
}
