import type { Child } from '../render/insert.ts';
import type { DashboardCollection, DashboardField } from '../runtime/meta-types.ts';

import { isUndefined } from '../../utils/is/is-undefined.ts';
import { onCleanup } from '../../utils/reactive/effect-scope.ts';
import { effect } from '../../utils/reactive/effect.ts';
import { ref } from '../../utils/reactive/ref.ts';
import { untracked } from '../../utils/reactive/untracked.ts';
import { when } from '../render/when.ts';
import { useT } from '../runtime/use-t.ts';
import { button } from '../ui/button.ts';
import { icon } from '../ui/icon.ts';
import { attachTooltip } from '../ui/tooltip.ts';

/**
 * The request a `record` or `records` control opens the record picker with.
 */
export interface RecordPickerRequest {
  /**
   * The relation field the pick is for; its label titles the picker.
   */
  field: DashboardField;

  /**
   * The readable target collection whose records the picker browses.
   */
  target: DashboardCollection;

  /**
   * The currently linked record `UUID`s, seeding the picker's selection.
   */
  values: readonly string[];

  /**
   * Whether the picker selects many records; `false` picks exactly one.
   */
  multiple: boolean;

  /**
   * Called with the picked `UUID`s when the selection applies.
   * A single pick arrives as a one-entry list.
   */
  onApply(uuids: string[]): void;

  /**
   * Called after the picker's close transition; the host then disposes the region that opened it.
   */
  onClose(): void;
}

/**
 * Opens the record picker for one request.
 * Call it inside a reactive region: the picker's effects and cleanup belong to that region.
 */
export type RecordPicker = (request: RecordPickerRequest) => void;

let active: RecordPicker | undefined;

/**
 * Registers the record picker the relation controls open.
 * The dashboard layer registers its table popup at boot; core only holds the seam.
 */
export function registerRecordPicker(picker: RecordPicker): void {
  active = picker;
}

/**
 * The registered record picker, or `undefined` before one registers.
 * Relation controls render their picker trigger only while one is registered.
 */
export function recordPicker(): RecordPicker | undefined {
  return active;
}

/**
 * Options for `pickerTrigger`.
 */
export interface PickerTriggerOptions {
  /**
   * The relation field the pick is for.
   */
  field: DashboardField;

  /**
   * The readable target collection the picker browses.
   */
  target: DashboardCollection;

  /**
   * The currently linked record `UUID`s, read when the picker opens.
   */
  values: () => readonly string[];

  /**
   * Whether the picker selects many records.
   */
  multiple: boolean;

  /**
   * Whether the trigger is disabled, read reactively.
   */
  disabled?: () => boolean;

  /**
   * Called with the picked `UUID`s when the picker's selection applies.
   */
  onApply(uuids: string[]): void;
}

/**
 * The table-overview button beside a relation input, and the region hosting its picker.
 * Renders nothing when no picker is registered: a control then keeps its combobox alone.
 * Place `trigger` before the input and `host` anywhere in the same element.
 */
export function pickerTrigger(
  options: PickerTriggerOptions,
): { trigger: HTMLElement; host: Child } | undefined {
  const open = recordPicker();
  if (isUndefined(open)) return undefined;
  const t = useT();
  const pickerOpen = ref(false);
  const trigger = button(icon('table'), {
    variant: 'outline',
    disabled: options.disabled,
    onClick: () => {
      pickerOpen.value = true;
    },
  });
  effect(() => {
    trigger.setAttribute('aria-label', t('dashboard.tableOverview'));
  });
  onCleanup(attachTooltip(trigger, () => t('dashboard.tableOverview')));
  const host = when(
    () => pickerOpen.value,
    () => {
      open({
        field: options.field,
        target: options.target,
        values: untracked(options.values),
        multiple: options.multiple,
        onApply: options.onApply,
        onClose: () => {
          pickerOpen.value = false;
        },
      });
      return null;
    },
  );
  return { trigger, host };
}
