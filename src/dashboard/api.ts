import { dashboardConfig } from './config.ts';

/**
 * Fetches `path` from the API the dashboard is configured for, sending credentials.
 * Returns the raw `Response`; the caller decides how to read it.
 */
export function api(path: string, init?: RequestInit): Promise<Response> {
  return fetch(`${dashboardConfig().apiURL}${path}`, { credentials: 'include', ...init });
}
