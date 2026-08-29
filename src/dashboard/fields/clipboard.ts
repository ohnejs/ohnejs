import { isArray } from '../../utils/is/is-array.ts';
import { isPlainObject } from '../../utils/is/is-plain-object.ts';
import { isString } from '../../utils/is/is-string.ts';
import { type Ref, ref } from '../../utils/reactive/ref.ts';

/**
 * The dashboard's clipboard payload union.
 */
export type ClipboardData =
  | {
      /**
       * Marks the payload as a copied block list.
       */
      ohneClipboardDataType: 'blocks';

      /**
       * The copied block values, each carrying its block type name as `$key` beside its fields.
       */
      data: ({ $key: string } & Record<string, unknown>)[];
    }
  | {
      /**
       * Marks the payload as a copied structure item.
       */
      ohneClipboardDataType: 'structure-item';

      /**
       * The copied item value, carrying its structure's item type as `$type` beside its subfields.
       */
      data: { $type: string } & Record<string, unknown>;
    };

/**
 * The one live clipboard payload, shared by every field in the dashboard.
 * `null` while nothing dashboard-shaped has been copied.
 */
export const clipboardData: Ref<ClipboardData | null> = ref<ClipboardData | null>(null);

/**
 * Copies a payload: writes `clipboardData` and best-effort mirrors the JSON onto the OS clipboard.
 * The mirror lets another tab or app read the payload; a refusal is swallowed, the ref still holds.
 * `null` clears the dashboard clipboard.
 */
export function copyClipboard(data: ClipboardData | null): void {
  clipboardData.value = data;
  void navigator.clipboard?.writeText(JSON.stringify(data)).catch(() => undefined);
}

/**
 * Whether a parsed JSON value is a well-formed `ClipboardData` payload.
 * Guards a payload read back from the OS clipboard, where the text is foreign and untrusted.
 */
export function isClipboardData(value: unknown): value is ClipboardData {
  if (!isPlainObject<Record<string, unknown>>(value)) return false;
  if (value.ohneClipboardDataType === 'blocks') {
    return (
      isArray(value.data) &&
      value.data.every(
        (item) => isPlainObject<Record<string, unknown>>(item) && isString(item.$key),
      )
    );
  }
  if (value.ohneClipboardDataType === 'structure-item') {
    return isPlainObject<Record<string, unknown>>(value.data) && isString(value.data.$type);
  }
  return false;
}

/**
 * A deep copy of a wire value with every `UUID` key removed, at every depth.
 * Copies, duplicates, and cross-structure transfers shed row identity through it.
 * A pasted or duplicated item therefore inserts as a new row instead of claiming an existing one.
 * `UUID` never names a regular field, since forms reserve it for row identity.
 */
export function stripUUIDs(value: unknown): unknown {
  if (isArray(value)) return value.map(stripUUIDs);
  if (isPlainObject<Record<string, unknown>>(value)) {
    const clean: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value)) {
      if (key !== 'UUID') clean[key] = stripUUIDs(entry);
    }
    return clean;
  }
  return value;
}
