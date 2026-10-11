/**
 * The uppercased first letters of a name's first and last words.
 * A single word gives one letter; blank text gives `''`.
 * Letters outside the Basic Multilingual Plane stay whole.
 *
 * @example
 * ```ts
 * initials('Anduin Wrynn')            // -> 'AW'
 * initials('Jaina  Lady  Proudmoore') // -> 'JP'
 * initials('thrall')                  // -> 'T'
 * initials('   ')                     // -> ''
 * ```
 */
export function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  const ends = words.length > 1 ? [words[0]!, words.at(-1)!] : words;
  return ends.map((word) => [...word][0]!.toUpperCase()).join('');
}
