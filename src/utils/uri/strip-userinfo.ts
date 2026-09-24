const USERINFO = /^((?:[A-Za-z][A-Za-z\d+.-]*:\/\/|\/\/)?)[\s\S]*@/;

/**
 * Removes the `user:password@` part from a URL string, so the rest is safe to print or log.
 * Works on the raw text, so a value no URL parser accepts is stripped too, scheme or not.
 * It cuts up to the last `@`, so a password holding `/` or `?` goes too, and so does an `@` in the path.
 *
 * @example
 * ```ts
 * stripUserinfo('s3://key:secret@photos/a')     // -> 's3://photos/a'
 * stripUserinfo('s3://key:se/cr?et@photos/a')   // -> 's3://photos/a'
 * stripUserinfo('key:secret@host:9000')         // -> 'host:9000'
 * stripUserinfo('s3://b?endpoint=http://u:p@h') // -> 's3://h'
 * stripUserinfo('https://host:9000/a')          // -> 'https://host:9000/a'
 * ```
 */
export function stripUserinfo(value: string): string {
  return value.replace(USERINFO, '$1');
}
