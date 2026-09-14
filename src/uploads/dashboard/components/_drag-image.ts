import { css, h } from 'ohnejs/dashboard';
import { isUndefined, ref } from 'ohnejs/utils';

import type { MediaView } from './media-library-state.ts';

const label = ref('');

let element: HTMLElement | undefined;

css`
  .o-media-drag-image {
    position: absolute;
    top: -100vh;
    left: -100vw;
    display: inline-flex;
    padding: 0.125rem 0.375rem;
    background-color: hsl(var(--ohne-primary));
    border-radius: var(--ohne-radius);
    color: hsl(var(--ohne-primary-foreground));
    font-size: 0.75rem;
    white-space: nowrap;
  }
`;

/**
 * The ghost a drag-to-move shows under the pointer: a primary pill with the moving count.
 * One element for the whole dashboard, parked off-screen in `body` and mounted on first use.
 */
export function dragImage(): HTMLElement {
  if (isUndefined(element)) {
    element = h(
      'div',
      { class: 'o-media-drag-image' },
      h('span', null, () => label.value),
    );
    document.body.append(element);
  }
  return element;
}

/**
 * Marks the view as moving and puts `text` on the drag ghost.
 */
export function startMoving(view: MediaView, text: string): void {
  label.value = text;
  view.moving.value = true;
}

/**
 * Ends the view's move and clears the ghost.
 */
export function stopMoving(view: MediaView): void {
  label.value = '';
  view.moving.value = false;
}
