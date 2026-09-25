const ATTACHMENT_TYPES = new Set([
  'text/html',
  'application/xhtml+xml',
  'text/xml',
  'application/xml',
  'text/javascript',
  'application/javascript',
  'application/xslt+xml',
  'application/mathml+xml',
  'application/rss+xml',
  'application/atom+xml',
]);

/**
 * How a browser opens a file of the media type `type`, wherever the file is served from.
 * A type a browser would run as a document is an `attachment`, so it never executes on the serving origin.
 *
 * @example
 * ```ts
 * dispositionFor('text/html') // -> 'attachment'
 * dispositionFor('image/png') // -> 'inline'
 * ```
 */
export function dispositionFor(type: string): 'attachment' | 'inline' {
  return ATTACHMENT_TYPES.has(type) ? 'attachment' : 'inline';
}
