const adopted = new Set<string>();

/**
 * Adopts a stylesheet into the document, once per unique text.
 * Call it at module top level beside the component it styles; the same text adopts only once.
 * Interpolations splice in, so tokens and shared fragments compose.
 * Sheets apply in first-adoption order, after the document's own stylesheets.
 *
 * @example
 * ```ts
 * css`
 *   .sheet-cell {
 *     border-bottom: 1px solid var(--hairline);
 *     font-variant-numeric: tabular-nums;
 *   }
 * `
 * ```
 */
export function css(strings: TemplateStringsArray, ...values: readonly (string | number)[]): void {
  const text = String.raw({ raw: strings }, ...values);
  if (adopted.has(text)) return;
  adopted.add(text);
  const sheet = new CSSStyleSheet();
  sheet.replaceSync(text);
  document.adoptedStyleSheets.push(sheet);
}
