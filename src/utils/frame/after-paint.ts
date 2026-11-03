interface Browser {
  document?: { visibilityState?: string };
  requestAnimationFrame?: (run: () => void) => number;
}

/**
 * Resolves once the browser has painted the next frame, so a long task after it cannot hide a DOM change.
 * Outside a browser and in a hidden tab, where no frame paints, it resolves at once.
 *
 * @example
 * ```ts
 * row.classList.add('active')
 * await afterPaint() // the highlight is on screen
 * buildHeavyPage()
 * ```
 */
export function afterPaint(): Promise<void> {
  const browser = globalThis as Browser;
  if (browser.document?.visibilityState !== 'visible' || !browser.requestAnimationFrame) {
    return Promise.resolve();
  }
  return new Promise((resolve) => browser.requestAnimationFrame?.(() => setTimeout(resolve)));
}
