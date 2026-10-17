import type { FieldForm } from './field-form.ts';
import type { FieldFolds } from './field-type.ts';

import { isUndefined } from '../../utils/is/is-undefined.ts';
import { hasKey } from '../../utils/object/has-key.ts';
import { identityOf } from './_items.ts';

/**
 * The node `folds` holds under `key`, a field's name or an item's key.
 */
export function foldsAt(folds: FieldFolds | undefined, key: string): FieldFolds | undefined {
  const children = folds?.children;
  return isUndefined(children) || !hasKey(children, key) ? undefined : children[key];
}

/**
 * The node a list's `folds` holds for `item`: by its `UUID`, else by the client key it carries.
 */
export function itemFolds(
  folds: FieldFolds | undefined,
  item: Readonly<Record<string, unknown>>,
): FieldFolds | undefined {
  const identity = identityOf(item);
  return isUndefined(identity) ? undefined : foldsAt(folds, String(identity));
}

/**
 * A list's folds: each item's own form folds and whether it shows collapsed, keyed as `itemFolds` reads them.
 */
export function listFolds(
  items: readonly { $key: number; uuid: string | undefined; $expanded: boolean; form: FieldForm }[],
): FieldFolds {
  return {
    children: Object.fromEntries(
      items.map((item) => [
        item.uuid ?? String(item.$key),
        { ...item.form.folds(), collapsed: !item.$expanded },
      ]),
    ),
  };
}
