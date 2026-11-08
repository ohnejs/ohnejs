/**
 * The RFC 4648 base32 alphabet, indexed by 5-bit value.
 *
 * @example
 * ```ts
 * BASE32_ALPHABET[0]  // -> 'A'
 * BASE32_ALPHABET[31] // -> '7'
 * ```
 */
export const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

/**
 * Crockford's base32 alphabet, indexed by 5-bit value.
 * It leaves out `I`, `L`, `O` and `U`, so a code read aloud or off paper is not misread.
 *
 * @example
 * ```ts
 * CROCKFORD_ALPHABET[0]  // -> '0'
 * CROCKFORD_ALPHABET[31] // -> 'Z'
 * ```
 */
export const CROCKFORD_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
