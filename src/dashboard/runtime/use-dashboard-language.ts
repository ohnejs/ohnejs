import { type Ref, ref } from '../../utils/reactive/ref.ts';
import { dashboardConfig } from './config.ts';

/**
 * Codegen extension point for every language the dashboard has a message catalog for.
 * Empty until codegen runs; the `browser/messages.ts` it emits augments this with one member per language.
 * Each member is a canonical BCP-47 tag, so `useDashboardLanguage` accepts only a language that exists.
 *
 * `type` aliases cannot be augmented, so the overridable tags live on this interface instead.
 *
 * @example
 * ```ts
 * declare module 'ohnejs/dashboard' {
 *   interface DashboardLanguages {
 *     en: true
 *     'de-AT': true
 *   }
 * }
 * ```
 */
export interface DashboardLanguages {}

/**
 * A language the dashboard can switch to.
 * Narrows to the generated union of tags once codegen has run; falls back to `string` until then.
 */
export type DashboardLanguage = [keyof DashboardLanguages] extends [never]
  ? string
  : keyof DashboardLanguages;

let current: Ref<DashboardLanguage> | undefined;

/**
 * Returns the reactive language the dashboard renders messages in, a process-wide singleton.
 *
 * Reading `.value` inside a reactive render subscribes to it.
 * Writing a new tag re-renders every `useT` string in place.
 * It starts at the injected `messages.defaultLanguage`.
 *
 * @example
 * ```ts
 * const language = useDashboardLanguage()
 *
 * h('p', null, () => useT()('nav.home')) // renders in the active language
 * language.value = 'de'                  // every message re-renders in German
 * ```
 */
export function useDashboardLanguage(): Ref<DashboardLanguage> {
  return (current ??= ref(dashboardConfig().defaultLanguage));
}
