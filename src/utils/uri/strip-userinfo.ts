const USERINFO = /^([A-Za-z][A-Za-z\d+.-]*:\/\/)[^/?#]*@/;

/**
 * Removes the `user:password@` part from a URL string, so the rest is safe to print or log.
 * Works on the raw text, so a value no URL parser accepts is stripped too.
 *
 * @example
 * ```ts
 * stripUserinfo('s3://key:secret@photos/a') // -> 's3://photos/a'
 * stripUserinfo('https://u:p@w@host:9000')  // -> 'https://host:9000'
 * stripUserinfo('https://host/a@b')         // -> 'https://host/a@b'
 * ```
 */
export function stripUserinfo(value: string): string {
  return value.replace(USERINFO, '$1');
}
