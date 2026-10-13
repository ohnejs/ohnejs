/**
 * Lowercases text one code point at a time, then composes it to NFC.
 * Unlike `String#toLowerCase`, a letter never depends on its neighbours.
 * So a final `Σ` becomes `σ`, as IDNA maps it.
 * Nothing else is folded: accents, compatibility forms, and `ß` stay as written.
 *
 * @example
 * ```ts
 * lowercase('Dalaran.Example') // -> 'dalaran.example'
 * lowercase('ΟΔΟΣ')            // -> 'οδοσ'
 * lowercase('MÜNCHEN')         // -> 'münchen'
 * ```
 */
export function lowercase(text: string): string {
  return Array.from(text, (char) => char.toLowerCase())
    .join('')
    .normalize('NFC');
}
