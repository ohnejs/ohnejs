/**
 * Matches one route param token: `[name]`, `[...name]`, or `:name`.
 * Group 1 marks a catch-all; group 2 or 3 holds the name.
 */
export const ROUTE_PARAM_RE = /\[(\.\.\.)?([A-Za-z_][A-Za-z0-9_]*)\]|:([A-Za-z_][A-Za-z0-9_]*)/g;

const DOT_SEGMENT = /^\.{0,2}$/;

/**
 * Whether `value` fills a param without changing the path's shape.
 * A catch-all splits it into `/`-separated segments; any other param takes one segment, so no `/`.
 * Every segment must hold more than `.` or `..`.
 */
export function fitsParam(value: string, catchAll: boolean): boolean {
  const segments = catchAll ? value.split('/') : [value];
  return segments.every((segment) => !segment.includes('/') && !DOT_SEGMENT.test(segment));
}
