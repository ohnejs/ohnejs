import { type Child, css, h, navigate, sessionUser } from 'ohne/dashboard';
import { effect, isNull, isNullish } from 'ohne/utils';

import { sidebar } from './sidebar.ts';

css`
  .shell {
    display: flex;
    height: 100%;
  }

  .shell-main {
    flex: 1;
    overflow: auto;
    padding: 28px 32px;
  }
`;

/**
 * The signed-in frame: the sidebar beside the page content.
 * While the session resolves it renders nothing, so the paper stays calm.
 * A signed-out session redirects to the login page, carrying the current path as `next`.
 */
export function shell(content: () => Child): Child {
  effect(() => {
    if (isNull(sessionUser())) {
      navigate(`/login?next=${encodeURIComponent(location.pathname)}`);
    }
  });
  return () => {
    if (isNullish(sessionUser())) return null;
    return h('div', { class: 'shell' }, sidebar(), h('main', { class: 'shell-main' }, content));
  };
}
