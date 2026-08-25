import { last } from '../../utils/array/last.ts';
import { isUndefined } from '../../utils/is/is-undefined.ts';

interface Layer {
  onEscape: () => void;
}

const stack: Layer[] = [];

function answer(event: KeyboardEvent): void {
  if (event.key !== 'Escape') return;
  const top = last(stack);
  if (isUndefined(top)) return;
  event.stopPropagation();
  top.onEscape();
}

/**
 * Claims the topmost Escape-answering layer; returns the release.
 * Stacked surfaces (drawers, popovers) each acquire a layer.
 * One Escape press reaches only the most recently acquired still-held layer.
 * Surfaces therefore close one per press, top first.
 * The single capture-phase `document` listener exists only while at least one layer is held.
 * Release removes the layer wherever it sits in the stack, so surfaces may close out of order.
 *
 * @example
 * ```ts
 * const release = acquireEscapeLayer(() => (open.value = false))
 * onCleanup(release)
 * ```
 */
export function acquireEscapeLayer(onEscape: () => void): () => void {
  if (stack.length === 0) document.addEventListener('keydown', answer, { capture: true });
  const layer: Layer = { onEscape };
  stack.push(layer);
  return () => {
    const at = stack.indexOf(layer);
    if (at === -1) return;
    stack.splice(at, 1);
    if (stack.length === 0) document.removeEventListener('keydown', answer, { capture: true });
  };
}
