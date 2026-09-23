const ROOT = /^\s*(?:<\?[\s\S]*?\?>\s*)*<([A-Za-z_][\w.:-]*)/;

/**
 * Returns the name of the root element of `xml`, past any `<?xml ?>` declaration and whitespace.
 * Returns `undefined` when the text does not open with an element.
 *
 * @example
 * ```ts
 * xmlRoot('<?xml version="1.0"?>\n<Error><Code>x</Code></Error>') // -> 'Error'
 * xmlRoot('<ListBucketResult/>')                                  // -> 'ListBucketResult'
 * xmlRoot('not xml')                                              // -> undefined
 * ```
 */
export function xmlRoot(xml: string): string | undefined {
  return ROOT.exec(xml)?.[1];
}
