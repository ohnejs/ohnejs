const HOST = /^(?:localhost|[\p{L}\p{N}-]+(?:\.[\p{L}\p{N}-]+)+)(?::\d+)?(?:[/?#]|$)/u;
const SCHEME = /^[A-Za-z][A-Za-z\d+.-]*:/;
const SPACE = /\s/;

/**
 * Reads text someone typed as the `href` they meant, or `undefined` when it does not look like one.
 * A bare host such as `example.com` gets `https://`, so a URL can be typed without its scheme.
 * A value with a scheme, a local `/path` and a `#fragment` are kept as typed, trimmed.
 * Text with a space inside is never one, so `Re: launch` reads as words, not as a scheme.
 *
 * The result is only read, never checked: pass it through `isSafeHref` before it becomes a link.
 * A `javascript:` URL is returned too, so a caller can say the URL is refused instead of searching for it.
 *
 * @example
 * ```ts
 * typedHref('example.com')         // -> 'https://example.com'
 * typedHref('example.com/a?b=1')   // -> 'https://example.com/a?b=1'
 * typedHref('localhost:3000')      // -> 'https://localhost:3000'
 * typedHref(' https://x.y ')       // -> 'https://x.y'
 * typedHref('mailto:a@b.c')        // -> 'mailto:a@b.c'
 * typedHref('/docs')               // -> '/docs'
 * typedHref('#top')                // -> '#top'
 * typedHref('javascript:alert(1)') // -> 'javascript:alert(1)'
 * typedHref('thrall')              // -> undefined
 * typedHref('thrall jaina')        // -> undefined
 * typedHref('Re: launch')          // -> undefined
 * ```
 */
export function typedHref(value: string): string | undefined {
  const text = value.trim();
  if (SPACE.test(text)) return undefined;
  if (HOST.test(text)) return `https://${text}`;
  if (text.startsWith('/') || text.startsWith('#') || SCHEME.test(text)) return text;
  return undefined;
}
