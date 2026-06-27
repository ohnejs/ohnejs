import { createRegistry, type Registry } from '../../utils/index.ts';

/**
 * One language's messages: a flat map of message key to ICU template.
 */
export type MessageCatalog = Record<string, string>;

const store: Registry<MessageCatalog> = createRegistry<MessageCatalog>();

/**
 * Returns the process-wide message store, keyed by canonical language tag.
 *
 * Each entry is one language's catalog: a flat map of message key to ICU template.
 * The generated `messages.ts` populates it at boot; `useT` and the messages endpoint read it.
 *
 * @example
 * ```ts
 * useMessages().register('en', { 'field.required': 'This field is required' })
 *
 * useMessages().get('en') // -> { 'field.required': 'This field is required' }
 * ```
 */
export function useMessages(): Registry<MessageCatalog> {
  return store;
}
