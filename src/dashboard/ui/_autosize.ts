import { onCleanup } from '../../utils/reactive/effect-scope.ts';

/**
 * Sizes `area` to its content whenever the returned function runs, and again when its width changes.
 * The caller runs it after each value change; the first size waits until the textarea is mounted.
 * The parent holds its height while the textarea is measured, so no scroll container above shrinks.
 */
export function autosizeTextarea(area: HTMLTextAreaElement): () => void {
  const autosize = (): void => {
    const parent = area.parentElement;
    if (!parent?.isConnected) return;
    const minHeight = parent.style.minHeight;
    // A shrunk pane clamps its `scrollTop` on the measuring layout, which the restored height never undoes.
    parent.style.minHeight = `${parent.offsetHeight}px`;
    // Collapsing to 1px first makes `scrollHeight` the exact content height plus padding.
    area.style.height = '1px';
    area.style.height = `${area.scrollHeight}px`;
    parent.style.minHeight = minHeight;
  };
  let lastWidth = 0;
  const observer = new ResizeObserver((entries) => {
    const width = entries[0]?.contentRect.width ?? 0;
    if (width === lastWidth) return;
    lastWidth = width;
    requestAnimationFrame(autosize);
  });
  observer.observe(area);
  onCleanup(() => observer.disconnect());
  // Out of the document `scrollHeight` is 0, so the initial value sizes once mounted.
  queueMicrotask(autosize);
  return autosize;
}
