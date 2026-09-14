import {
  button,
  type Child,
  css,
  defineDashboardPage,
  h,
  icon,
  setDocumentTitle,
  useT,
} from 'ohnejs/dashboard';
import { effect } from 'ohnejs/utils';

import { shell } from '../components/shell.ts';

css`
  .o-404 {
    display: flex;
    min-height: 100%;
  }

  .o-404-content {
    margin: auto;
    padding: 0.75rem;
    text-align: center;
  }

  .o-404-code {
    font-size: 3rem;
    color: hsl(var(--ohne-muted-foreground));
  }

  .o-404-text {
    margin-bottom: 2rem;
    font-size: 0.875rem;
    color: hsl(var(--ohne-muted-foreground));
  }
`;

/**
 * The catch-all page.
 * It claims every URL no other page matches, so an unknown path lands on the shell instead of a bare heading.
 * A signed-out visitor never reaches it: the shell redirects to the login page, carrying `next`.
 */
export default defineDashboardPage(() =>
  shell(() => notFound(), { noMainPadding: true, noMainScroll: true }),
);

/**
 * The page body: the dim code over the message, and one link back to the dashboard home.
 * There is no per-page chrome between the main area and the body: `.o-main-content` carries that height.
 */
function notFound(): Child {
  const t = useT();

  effect(() => setDocumentTitle(t('dashboard.pageNotFound')));

  return h(
    'div',
    { class: 'o-404' },
    h(
      'div',
      { class: 'o-404-content' },
      h('p', { class: 'o-404-code' }, '404'),
      h('p', { class: 'o-404-text' }, () => t('dashboard.pageNotFound')),
      button([icon('arrow-left'), h('span', null, () => t('dashboard.goBackHome'))], {
        href: '/',
        variant: 'secondary',
      }),
    ),
  );
}
