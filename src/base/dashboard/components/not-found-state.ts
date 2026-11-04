import { button, css, emptyState, h } from 'ohnejs/dashboard';

css`
  .o-not-found {
    display: grid;
    height: 100%;
    place-items: center;
  }
`;

/**
 * The not-found state a fill pane centers for a collection or record that does not exist, linking back home.
 */
export function notFoundState(): HTMLElement {
  return h(
    'div',
    { class: 'o-not-found' },
    emptyState('dashboard.notFound', {
      icon: 'file-unknown',
      action: button('dashboard.goBackHome', {
        href: '/',
        variant: 'secondary',
        icon: 'arrow-left',
      }),
    }),
  );
}
