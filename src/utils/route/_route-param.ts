/**
 * Matches one route param token: `[name]`, `[...name]`, or `:name`.
 * Group 1 marks a catch-all; group 2 or 3 holds the name.
 */
export const ROUTE_PARAM_RE = /\[(\.\.\.)?([A-Za-z_][A-Za-z0-9_]*)\]|:([A-Za-z_][A-Za-z0-9_]*)/g;
