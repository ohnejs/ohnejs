import { last } from '../../utils/array/last.ts';
import { isFunction } from '../../utils/is/is-function.ts';
import { effectScope, onCleanup } from '../../utils/reactive/effect-scope.ts';
import { effect } from '../../utils/reactive/effect.ts';
import { ref } from '../../utils/reactive/ref.ts';
import { untracked } from '../../utils/reactive/untracked.ts';
import { resolveText, type Text } from './text.ts';

const titles = ref<readonly (() => string | undefined)[]>([]);
let writing = false;

/**
 * Names the browser tab `title - ohne` while the calling scope lives.
 * The title resolves live, so it follows async data and a language switch.
 * An `undefined` or empty title leaves the bare `ohne`.
 * The most recent live call wins; once its scope ends, the one before it shows again.
 * With none live, the tab reads `ohne`.
 *
 * @example
 * ```ts
 * useDocumentTitle('dashboard.overview.title')
 * useDocumentTitle(() => post.value?.title)
 * ```
 */
export function useDocumentTitle(title: Text | (() => string | undefined)): void {
  const read = isFunction<() => string | undefined>(title) ? title : () => resolveText(title);
  titles.value = [...untracked(() => titles.value), read];
  onCleanup(() => {
    titles.value = untracked(() => titles.value).filter((entry) => entry !== read);
  });
  if (!writing) {
    effectScope(true).run(() => effect(writeTitle));
    writing = true;
  }
}

/**
 * Writes the newest live title to the document.
 */
function writeTitle(): void {
  const title = last(titles.value)?.();
  document.title = title ? `${title} - ohne` : 'ohne';
}
