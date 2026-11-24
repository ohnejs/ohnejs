import { hasKey } from '../object/has-key.ts';

/**
 * Defines `key` as an own enumerable property, so a `__proto__` key cannot reach the prototype.
 */
function assign(out: Record<string, string>, key: string, value: string): void {
  Object.defineProperty(out, key, { value, writable: true, enumerable: true, configurable: true });
}

/**
 * Parses `;`-separated SIP parameters, such as the tail of a `Via`, a URI, or a `name-addr`.
 * Names are lowercased; a flag without `=` maps to `''`.
 * Quoted values are unwrapped, honoring backslash escapes, so a `;` inside quotes survives.
 * The first occurrence of a name wins, and a `__proto__` parameter lands as an own property.
 *
 * @example
 * ```ts
 * parseSIPParams(';branch=z9hG4bK776;rport')         // -> { branch: 'z9hG4bK776', rport: '' }
 * parseSIPParams('Tag=a6c8;+sip.instance="<urn:x>"') // -> { tag: 'a6c8', '+sip.instance': '<urn:x>' }
 * parseSIPParams('')                                 // -> {}
 * ```
 */
export function parseSIPParams(text: string): Record<string, string> {
  const params: Record<string, string> = {};
  let i = 0;

  while (i < text.length) {
    while (i < text.length && (text[i] === ';' || text[i] === ' ' || text[i] === '\t')) i++;
    if (i === text.length) break;

    const nameStart = i;
    while (i < text.length && text[i] !== '=' && text[i] !== ';') i++;
    const name = text.slice(nameStart, i).trim().toLowerCase();

    let value = '';
    if (text[i] === '=') {
      i++;
      while (text[i] === ' ' || text[i] === '\t') i++;
      if (text[i] === '"') {
        i++;
        while (i < text.length && text[i] !== '"') {
          if (text[i] === '\\' && i + 1 < text.length) i++;
          value += text[i++];
        }
        while (i < text.length && text[i] !== ';') i++;
      } else {
        const valueStart = i;
        while (i < text.length && text[i] !== ';') i++;
        value = text.slice(valueStart, i).trim();
      }
    }

    if (name !== '' && !hasKey(params, name)) assign(params, name, value);
  }

  return params;
}
