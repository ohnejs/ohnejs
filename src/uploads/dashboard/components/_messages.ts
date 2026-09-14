import { type MessageParams, type Translate, useT } from 'ohnejs/dashboard';

/**
 * The translator the uploads dashboard speaks through.
 * Framework keys stay typed exactly as `useT` types them; the layer's own `uploads.*` keys are open.
 * Those keys live in the layer's catalog, generated only into an app that stacks the layer.
 * This program's `KnownMessages` never lists them, so the intersection bridges the gap by overload.
 */
export type UploadsTranslate = Translate &
  ((key: `uploads.${string}`, params?: MessageParams) => string);

/**
 * Returns `useT`'s translator widened to accept the uploads catalog's keys.
 * A framework key keeps its parameter typing; an `uploads.*` key takes an optional parameter bag.
 */
export function useUploadsT(): UploadsTranslate {
  return useT() as UploadsTranslate;
}
