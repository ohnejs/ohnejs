import { effect } from '../../utils/reactive/effect.ts';
import { ref } from '../../utils/reactive/ref.ts';
import { untracked } from '../../utils/reactive/untracked.ts';

const event = ref<{ name: string } | null>(null);

/**
 * Dispatches a named ui event to every `listenTrigger` listener.
 * The bus is how loosely coupled controls nudge each other, like a field label focusing its control.
 */
export function dispatchTrigger(name: string): void {
  event.value = { name };
}

/**
 * Listens for a named ui event; returns the stop function.
 * A listener registered inside a reactive region is disposed with it, so releasing is usually implicit.
 *
 * @example
 * ```ts
 * listenTrigger('focus:email', () => input.focus())
 * dispatchTrigger('focus:email')
 * ```
 */
export function listenTrigger(name: string, callback: () => void): () => void {
  let last = untracked(() => event.value);
  return effect(() => {
    const current = event.value;
    if (current === last) return;
    last = current;
    if (current?.name === name) callback();
  });
}
