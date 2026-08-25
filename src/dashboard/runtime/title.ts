/**
 * Sets the document title from an optional page chunk.
 * A chunk renders as `chunk - ohne`; an absent or empty chunk leaves the bare `ohne`.
 * Mirrors Pruvious v4's `titleTemplate`, with the brand renamed.
 * Call it inside an effect that reads the data the title shows, so it follows async loads.
 */
export function setDocumentTitle(chunk?: string): void {
  document.title = chunk ? `${chunk} - ohne` : 'ohne';
}
