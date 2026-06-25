import { hasKey } from '../object/has-key.ts';

/**
 * One proxy hop from a `Forwarded` header, its parameters keyed by lowercased name.
 * The four standard parameters are typed; any extension parameter is reachable through the index.
 */
export interface ForwardedElement {
  /**
   * The interface the request arrived on, from the `by` parameter.
   */
  by?: string;

  /**
   * The client that initiated the request, from the `for` parameter.
   */
  for?: string;

  /**
   * The host the client requested, from the `host` parameter.
   */
  host?: string;

  /**
   * The protocol the client used (`http` / `https`), from the `proto` parameter.
   */
  proto?: string;

  /**
   * Any extension parameter, keyed by lowercased name, with its value kept verbatim.
   */
  [param: string]: string | undefined;
}

function assign(element: ForwardedElement, name: string, value: string): void {
  Object.defineProperty(element, name, {
    value,
    writable: true,
    enumerable: true,
    configurable: true,
  });
}

/**
 * Parses an RFC 7239 `Forwarded` header into one element per proxy hop, leftmost first.
 * Each element maps lowercased parameter names to their values; the first value of a name wins.
 *
 * Quoted values are unwrapped, honoring backslash escapes, so a `,` or `;` inside quotes survives.
 * This is how an IPv6 `for="[2001:db8::1]:4711"` stays intact.
 * Untrusted input never throws, and a `__proto__` parameter lands as an own property.
 *
 * @example
 * ```ts
 * parseForwarded('for=192.0.2.60;proto=http;by=203.0.113.43')
 * // -> [{ for: '192.0.2.60', proto: 'http', by: '203.0.113.43' }]
 *
 * parseForwarded('for=192.0.2.43, for="[2001:db8::17]:4711"')
 * // -> [{ for: '192.0.2.43' }, { for: '[2001:db8::17]:4711' }]
 *
 * parseForwarded('')
 * // -> []
 * ```
 */
export function parseForwarded(header: string): ForwardedElement[] {
  const elements: ForwardedElement[] = [];
  let element: ForwardedElement = {};
  let hasPairs = false;
  let i = 0;

  while (i < header.length) {
    const char = header[i];

    if (char === ' ' || char === '\t' || char === ';') {
      i++;
      continue;
    }

    if (char === ',') {
      if (hasPairs) {
        elements.push(element);
        element = {};
        hasPairs = false;
      }
      i++;
      continue;
    }

    const nameStart = i;
    while (i < header.length && header[i] !== '=' && header[i] !== ';' && header[i] !== ',') i++;
    const name = header.slice(nameStart, i).trim().toLowerCase();
    if (header[i] !== '=' || name === '') continue;
    i++;

    let value: string;
    if (header[i] === '"') {
      i++;
      let buffer = '';
      while (i < header.length && header[i] !== '"') {
        if (header[i] === '\\' && i + 1 < header.length) i++;
        buffer += header[i++];
      }
      i++;
      value = buffer;
    } else {
      const valueStart = i;
      while (i < header.length && header[i] !== ';' && header[i] !== ',') i++;
      value = header.slice(valueStart, i).trim();
    }

    if (!hasKey(element, name)) {
      assign(element, name, value);
      hasPairs = true;
    }
  }

  if (hasPairs) elements.push(element);

  return elements;
}
