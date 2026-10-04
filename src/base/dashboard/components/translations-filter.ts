import type { Ref } from 'ohnejs/utils';

import {
  dashboardMeta,
  type FieldFilter,
  type Primitive,
  select,
  type SelectChoice,
} from 'ohnejs/dashboard';

import { effectiveContentLocale, languageName } from './content-language-switcher.ts';

/**
 * The `_translations` filter: whether a record holds a translation at a chosen content locale.
 * `notIncludes` leads, so a fresh condition lists what the active locale still lacks.
 */
export const translationsFilter: FieldFilter = {
  operators: () => ['notIncludes', 'includes'],
  seed: () => effectiveContentLocale(),
  input({ value, commit, inputID }) {
    const bridged: Ref<Primitive> = {
      get value() {
        return value();
      },
      set value(next) {
        commit(String(next));
      },
    };
    return select(
      bridged,
      (): SelectChoice[] =>
        (dashboardMeta()?.locales ?? []).map((code) => ({
          value: code,
          label: languageName(code),
        })),
      { id: inputID, name: inputID },
    );
  },
};
