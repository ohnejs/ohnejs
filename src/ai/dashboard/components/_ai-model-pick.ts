import { isNull, isUndefined, type Ref, ref } from 'ohnejs/utils';

import { aiMeta } from './_ai-meta.ts';

const KEY = 'ohne:ai:model';

/**
 * The `ai.models` entry the person picked for their turns, `null` for the app's default.
 * Remembered in this browser, so the pick outlives the page.
 * Reactive.
 */
export const pickedModel: Ref<string | null> = ref(storedPick());

/**
 * Picks the `ai.models` entry the next turns plan with, `null` for the app's default, and remembers it.
 */
export function setPickedModel(name: string | null): void {
  pickedModel.value = name;
  try {
    if (isNull(name)) localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, name);
  } catch {
    // Storage may be blocked or full; the pick still holds for this page.
  }
}

/**
 * The model the next turn plans with: the pick while the discovery read lists it, else the app's default.
 * `undefined` before the discovery read lands.
 * Reactive.
 */
export function currentModel(): string | undefined {
  const meta = aiMeta();
  if (isUndefined(meta)) return undefined;
  const pick = pickedModel.value;
  return !isNull(pick) && meta.models.includes(pick) ? pick : meta.model;
}

/**
 * The model to send on `POST /ai/turns`: the pick when it differs from the app's default, else nothing.
 * Reactive.
 */
export function turnModel(): string | undefined {
  const model = currentModel();
  return isUndefined(model) || model === aiMeta()?.model ? undefined : model;
}

/**
 * The pick this browser remembers, `null` when none or when storage is out of reach.
 */
function storedPick(): string | null {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
}
