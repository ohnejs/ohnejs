import { computed, type ComputedRef } from '../../utils/reactive/computed.ts';
import { type Ref, ref } from '../../utils/reactive/ref.ts';
import { untracked } from '../../utils/reactive/untracked.ts';
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

let requested: Ref<DashboardLanguage> | undefined;
const committed = ref<DashboardLanguage | undefined>(undefined);
let rendered: ComputedRef<DashboardLanguage> | undefined;

/**
 * Returns the language the dashboard renders in: the one on screen, read-only and reactive.
 *
 * Reading `.value` inside a function child subscribes it, so a `useT` string follows a switch in place.
 * Switch it through `setDashboardLanguage`, which loads the new language's catalogs first.
 * A switch lands at once while no navigation is pending, and together with the arriving page otherwise.
 * It starts at the app's `messages.defaultLanguage`.
 *
 * @example
 * ```ts
 * h('p', null, () => useDashboardLanguage().value) // renders the active tag, like 'en'
 * h('p', null, () => useT()('nav.home'))          // renders in the active language
 * ```
 */
export function useDashboardLanguage(): ComputedRef<DashboardLanguage> {
  return (rendered ??= computed(() => committed.value ?? requestedLanguage().value));
}

/**
 * The language the dashboard was last asked for: the one its catalogs load and its requests speak.
 * The router commits it as the rendered language through `commitDashboardLanguage`.
 */
export function requestedLanguage(): Ref<DashboardLanguage> {
  return (requested ??= ref(dashboardConfig().defaultLanguage));
}

/**
 * Makes the requested language the rendered one, so every live string switches to it.
 * Before the first commit the rendered language follows the request.
 */
export function commitDashboardLanguage(): void {
  committed.value = untracked(() => requestedLanguage().value);
}
