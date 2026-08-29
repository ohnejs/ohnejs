import type { Child } from '../render/insert.ts';

import { isUndefined } from '../../utils/is/is-undefined.ts';
import { onCleanup } from '../../utils/reactive/effect-scope.ts';
import { css } from '../render/css.ts';
import { h } from '../render/h.ts';
import { dialogHost } from './dialog.ts';
import { isMac } from './hotkeys.ts';
import { toaster } from './toaster.ts';
import './tokens.ts';

/**
 * Options for `base`.
 */
export interface BaseOptions {
  /**
   * Size step pinned on the root as `--ohne-size`.
   * Omitted inherits the ancestor value.
   */
  size?: number;

  /**
   * Spacing step pinned on the root as `--ohne-spacing`.
   * Omitted inherits the ancestor value.
   */
  spacing?: number;
}

css`
  :root {
    --o-green: 160 100% 30%;
    --o-orange: 32 100% 51%;
    --o-purple: 275 82% 38%;
    --o-yellow: 52 100% 56%;
  }

  html,
  body {
    overscroll-behavior: none;
    -webkit-overflow-scrolling: auto;
  }

  .o-scrollbar,
  .ohne-container {
    scrollbar-width: thin;
    scrollbar-color: hsl(var(--ohne-foreground) / 0.25) transparent;
  }

  .o-scrollbar::-webkit-scrollbar,
  .ohne-container::-webkit-scrollbar {
    width: 10px;
    height: 10px;
  }

  .o-scrollbar::-webkit-scrollbar-thumb,
  .ohne-container::-webkit-scrollbar-thumb {
    background-color: hsl(var(--ohne-foreground) / 0.25);
    background-clip: padding-box;
    border-radius: 6px;
    border: 2px solid transparent;
  }

  .o-scrollbar::-webkit-scrollbar-track,
  .ohne-container::-webkit-scrollbar-track {
    background-color: transparent;
  }
`;

/**
 * The root host a dashboard screen renders through.
 * It wraps the content and mounts the app-wide singletons beside it: the dialog host and the toaster.
 * Render exactly one per screen; the classes are structural hooks and carry no styling of their own.
 * While mounted it swallows the plain platform-modifier `D` and `S` keydowns.
 * The match is on physical `event.code`.
 * So browser bookmark and save-page never fire and dashboard hotkeys own them.
 */
export function base(content: Child | (() => Child), options: BaseOptions = {}): HTMLElement {
  const mac = isMac();
  const suppress = (event: KeyboardEvent): void => {
    if (
      (event.code === 'KeyD' || event.code === 'KeyS') &&
      (mac
        ? event.metaKey && !event.altKey && !event.ctrlKey && !event.shiftKey
        : event.ctrlKey && !event.altKey && !event.metaKey && !event.shiftKey)
    ) {
      event.preventDefault();
    }
  };
  window.addEventListener('keydown', suppress);
  onCleanup(() => window.removeEventListener('keydown', suppress));

  const style = [
    isUndefined(options.size) ? '' : `--ohne-size: ${options.size};`,
    isUndefined(options.spacing) ? '' : `--ohne-spacing: ${options.spacing};`,
  ].join('');
  return h(
    'div',
    { class: 'ohne-base', style: style === '' ? undefined : style },
    h('div', { class: 'ohne-base-content' }, content),
    dialogHost(),
    toaster(),
  );
}
