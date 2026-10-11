import { isUndefined } from '../../utils/is/is-undefined.ts';
import { onCleanup } from '../../utils/reactive/effect-scope.ts';
import { isEditingText } from '../ui/hotkeys.ts';
import { setNavigationGuard } from './router.ts';

const sources = new Set<() => boolean>();
let prompt: (() => Promise<boolean>) | undefined;

/**
 * Guards the current scope's edits: while `dirty` reports `true`, leaving asks before it discards them.
 * A navigation that leaves the pathname waits on the registered leave prompt.
 * Closing the tab raises the browser's own leave prompt.
 * The source counts until the reactive scope that registered it is disposed.
 *
 * @example
 * ```ts
 * const draft = ref('')
 * useUnsavedChanges(() => draft.value !== '')
 * ```
 */
export function useUnsavedChanges(dirty: () => boolean): void {
  sources.add(dirty);
  sync();
  onCleanup(() => {
    sources.delete(dirty);
    sync();
  });
}

/**
 * Registers the dialog that asks whether to leave dirty edits, for as long as the current scope lives.
 * The prompt resolves `true` to leave, discarding the edits, or `false` to stay.
 * Without one, every guarded step leaves at once.
 *
 * @example
 * ```ts
 * registerLeavePrompt(() => confirm({ title: 'Discard your changes?' }))
 * ```
 */
export function registerLeavePrompt(next: () => Promise<boolean>): void {
  prompt = next;
  onCleanup(() => {
    if (prompt === next) prompt = undefined;
  });
}

/**
 * Asks the registered leave prompt whether to discard edits, resolving `true` when none is registered.
 * A surface with its own dirty state, like a popup closing on Escape, asks through it.
 *
 * @example
 * ```ts
 * if (!dirty.value || (await confirmLeave())) close()
 * ```
 */
export function confirmLeave(): Promise<boolean> {
  return isUndefined(prompt) ? Promise.resolve(true) : prompt();
}

/**
 * Drops every registered source, so the next navigation leaves without asking.
 * A redirect that must land, like the one after the session is lost, releases them first.
 *
 * @example
 * ```ts
 * releaseUnsavedChanges()
 * navigate('/login')
 * ```
 */
export function releaseUnsavedChanges(): void {
  sources.clear();
  sync();
}

/**
 * Whether any registered source reports dirty edits.
 *
 * @example
 * ```ts
 * useUnsavedChanges(() => true)
 * hasUnsavedChanges() // -> true
 * ```
 */
export function hasUnsavedChanges(): boolean {
  for (const dirty of sources) if (dirty()) return true;
  return false;
}

/**
 * The navigation guard: a dirty source holds the step on the leave prompt.
 */
function guard(): boolean | Promise<boolean> {
  return !hasUnsavedChanges() || isUndefined(prompt) ? true : prompt();
}

/**
 * Raises the browser's leave prompt over dirty edits.
 * A focused text control blurs first, so an edit it commits on blur counts.
 */
function onBeforeUnload(event: BeforeUnloadEvent): void {
  if (isEditingText() && document.activeElement instanceof HTMLElement) {
    document.activeElement.blur();
  }
  if (hasUnsavedChanges()) {
    event.preventDefault();
    event.returnValue = '';
  }
}

/**
 * Installs the navigation guard and the tab-close listener while any source is registered.
 */
function sync(): void {
  const guarded = sources.size > 0;
  setNavigationGuard(guarded ? guard : null);
  if (guarded) window.addEventListener('beforeunload', onBeforeUnload);
  else window.removeEventListener('beforeunload', onBeforeUnload);
}
