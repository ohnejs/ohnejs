import { isNull } from '../../utils/is/is-null.ts';
import { isUndefined } from '../../utils/is/is-undefined.ts';

/**
 * The slice of the shared drag state that `structureAccepts` inspects.
 */
export interface StructureDragSource {
  /**
   * The id of the structure the item is dragged from.
   * `null` marks a cross-drop-capable item that may land in any accepting structure.
   */
  structureId: string | null;

  /**
   * The type of the item being dragged, used to filter cross-structure drops.
   */
  type: string | undefined;
}

/**
 * Decides whether a structure accepts the in-flight drag.
 * A structure always accepts its own items.
 * A cross-drop item (`structureId === null`) lands only in a structure that allows cross drops.
 * There, a defined `types` list refuses a defined draggable type it does not include.
 * Everything else - no drag in flight, or another structure's non-cross item - is refused.
 */
export function structureAccepts(
  draggable: StructureDragSource | null,
  structureId: string,
  allowCrossDrop: boolean,
  types?: string[],
): boolean {
  if (draggable) {
    if (isNull(draggable.structureId)) {
      if (allowCrossDrop) {
        return isUndefined(types) || isUndefined(draggable.type) || types.includes(draggable.type);
      }
    } else if (draggable.structureId === structureId) {
      return true;
    }
  }

  return false;
}

/**
 * Resolves the final insertion index for a drop on an item's zone.
 * `'after'` targets the slot below the item, so the index advances by one.
 * For a same-structure drop, pass the dragged item's `draggableIndex`.
 * A target below it then shifts up by one, because the item is removed before it is re-inserted.
 * Pass `null` for a cross-structure drop, where nothing leaves the receiving list first.
 */
export function structureDropIndex(
  index: number,
  position: 'before' | 'after',
  draggableIndex: number | null,
): number {
  const target = position === 'after' ? index + 1 : index;
  return !isNull(draggableIndex) && target > draggableIndex ? target - 1 : target;
}
