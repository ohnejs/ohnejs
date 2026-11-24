const COMPACT = new Map(
  Object.entries({
    b: 'Referred-By',
    c: 'Content-Type',
    e: 'Content-Encoding',
    f: 'From',
    i: 'Call-ID',
    k: 'Supported',
    l: 'Content-Length',
    m: 'Contact',
    o: 'Event',
    r: 'Refer-To',
    s: 'Subject',
    t: 'To',
    u: 'Allow-Events',
    v: 'Via',
    x: 'Session-Expires',
  }),
);

const SPELLED = new Map(
  [
    ...COMPACT.values(),
    'Accept',
    'Allow',
    'Authorization',
    'CSeq',
    'Date',
    'Expires',
    'Max-Forwards',
    'Min-Expires',
    'Organization',
    'P-Asserted-Identity',
    'Proxy-Authenticate',
    'Proxy-Authorization',
    'Proxy-Require',
    'RAck',
    'Reason',
    'Record-Route',
    'Require',
    'Retry-After',
    'Route',
    'RSeq',
    'Server',
    'Unsupported',
    'User-Agent',
    'Warning',
    'WWW-Authenticate',
  ].map((name) => [name.toLowerCase(), name]),
);

/**
 * The canonical spelling of the SIP header `name`.
 * A compact form expands to its long name and a known name takes its RFC casing.
 * Any other name stays as written.
 */
export function canonicalSIPName(name: string): string {
  const lower = name.toLowerCase();
  return COMPACT.get(lower) ?? SPELLED.get(lower) ?? name;
}
