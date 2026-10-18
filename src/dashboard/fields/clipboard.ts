import type { DashboardField } from '../runtime/meta-types.ts';

import { isArray } from '../../utils/is/is-array.ts';
import { isPlainObject } from '../../utils/is/is-plain-object.ts';
import { isString } from '../../utils/is/is-string.ts';
import { isUndefined } from '../../utils/is/is-undefined.ts';
import { jsonClone } from '../../utils/json/json-clone.ts';
import { deepOmit } from '../../utils/object/deep-omit.ts';
import { effect } from '../../utils/reactive/effect.ts';
import { type Ref, ref } from '../../utils/reactive/ref.ts';
import { blocksOf } from './_blocks.ts';
import { blockNamed } from './_items.ts';

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

const IDENTITIES: readonly string[] = ['UUID', '$key'];

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
 * A deep copy of an item form's draft with each item's `UUID` and client `$key` removed, at every depth.
 * It follows `fields` into objects, repeaters, and blocks, so a field's own data, like JSON, keeps both keys.
 * A key no field declares sheds both at every depth, so a mismatched shape never carries an identity.
 * Copies, duplicates, and cross-structure transfers shed item identity through it.
 * A pasted or duplicated item therefore inserts as a new row instead of claiming an existing one.
 */
export function stripIdentities(
  draft: Readonly<Record<string, unknown>>,
  fields: readonly DashboardField[],
): Record<string, unknown> {
  const blocks = blocksOf();
  const shed = (
    item: Readonly<Record<string, unknown>>,
    known: readonly DashboardField[],
  ): Record<string, unknown> => {
    const copy: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(item)) {
      if (IDENTITIES.includes(key)) continue;
      const field = known.find((candidate) => candidate.name === key);
      copy[key] = isUndefined(field) ? deepOmit(entry, IDENTITIES) : within(entry, field);
    }
    return copy;
  };
  const block = (node: Readonly<Record<string, unknown>>): Record<string, unknown> => {
    const { fields: data, ...rest } = node;
    if (!isPlainObject<Record<string, unknown>>(data) || !isString(node.block)) {
      return shed(node, []);
    }
    return { ...shed(rest, []), fields: shed(data, blockNamed(blocks, node.block)?.fields ?? []) };
  };
  const within = (value: unknown, field: DashboardField): unknown => {
    const subfields = field.subfields ?? [];
    if (isPlainObject<Record<string, unknown>>(value)) {
      return field.kind === 'childOne' ? shed(value, subfields) : value;
    }
    if (!isArray(value) || (field.kind !== 'childMany' && field.kind !== 'blocks')) return value;
    return value.map((item) => {
      if (!isPlainObject<Record<string, unknown>>(item)) return item;
      return field.kind === 'blocks' ? block(item) : shed(item, subfields);
    });
  };
  return shed(jsonClone(draft), fields);
}

/**
 * Keeps `clipboardData` in step with the OS clipboard while `enabled()` reads true.
 * An effect over `enabled`: on true it reads at once and on every window focus, on false it detaches.
 * A read parses the clipboard text as JSON and stores it when it is a `ClipboardData` payload.
 * Every failure is swallowed: a denied permission, foreign text, a browser without the API.
 * Returns the stop, which ends the effect and detaches the listener.
 *
 * @example
 * ```ts
 * watchOSClipboard(() => sessionUser()?.smartClipboard === true)
 * ```
 */
export function watchOSClipboard(enabled: () => boolean): () => void {
  const read = (): void => {
    void readOSClipboard();
  };
  let watching = false;
  const watch = (on: boolean): void => {
    if (on === watching) return;
    watching = on;
    if (on) {
      read();
      window.addEventListener('focus', read);
    } else {
      window.removeEventListener('focus', read);
    }
  };
  const stop = effect(() => watch(enabled()));
  return () => {
    stop();
    watch(false);
  };
}

/**
 * Reads the OS clipboard into `clipboardData` when it holds a dashboard payload; anything else is ignored.
 */
async function readOSClipboard(): Promise<void> {
  try {
    const text = await navigator.clipboard?.readText();
    if (isUndefined(text)) return;
    const parsed: unknown = JSON.parse(text);
    if (isClipboardData(parsed)) clipboardData.value = parsed;
  } catch {}
}
