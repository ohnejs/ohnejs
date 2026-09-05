import { isUndefined, naturalCompare } from 'ohne/utils';

import type { UploadRecord } from '../../uploads/types.ts';

/**
 * One folder of the move target tree.
 */
export interface TargetDirectory {
  /**
   * The folder path, `''` at the root.
   */
  path: string;

  /**
   * The folder's own name; the root carries the caller's label.
   */
  name: string;

  /**
   * Whether the selection may not land here: the folder is selected itself or sits inside a selected one.
   */
  disabled: boolean;

  /**
   * The subfolders, sorted naturally by name.
   */
  children: TargetDirectory[];
}

/**
 * Builds the move target tree from every folder path, rooted at `''`.
 * A missing ancestor is implied from its descendants' paths.
 * A folder is disabled when it is among the moved records or sits inside one of them.
 * The root is disabled when every moved record already sits there.
 *
 * @example
 * ```ts
 * const tree = buildTargetTree(['photos', 'photos/2024', 'docs'], [photosFolder], 'Root')
 *
 * tree.children.map((child) => child.name) // -> ['docs', 'photos']
 * tree.children[1].disabled                // -> true
 * tree.children[1].children[0].disabled    // -> true
 * ```
 */
export function buildTargetTree(
  paths: readonly string[],
  records: readonly UploadRecord[],
  rootName: string,
): TargetDirectory {
  const root: TargetDirectory = {
    path: '',
    name: rootName,
    disabled: records.every((record) => record.directory === ''),
    children: [],
  };
  for (const path of paths) {
    const segments = path.split('/').filter((segment) => segment !== '');
    let level = root.children;
    for (let index = 0; index < segments.length; index++) {
      const segment = segments[index] as string;
      let node = level.find((entry) => entry.name === segment);
      if (isUndefined(node)) {
        const nodePath = segments.slice(0, index + 1).join('/');
        node = {
          path: nodePath,
          name: segment,
          disabled: isSelectedOrInside(nodePath, records),
          children: [],
        };
        level.push(node);
      }
      level = node.children;
    }
  }
  sortChildren(root);
  return root;
}

/**
 * Whether any folder of the tree, the root included, may take the selection.
 *
 * @example
 * ```ts
 * hasValidTarget({ path: '', name: 'Root', disabled: true, children: [] }) // -> false
 * ```
 */
export function hasValidTarget(node: TargetDirectory): boolean {
  return !node.disabled || node.children.some(hasValidTarget);
}

/**
 * Whether `path` is a moved record's own path or sits anywhere beneath one.
 */
function isSelectedOrInside(path: string, records: readonly UploadRecord[]): boolean {
  return records.some((record) => record.path === path || path.startsWith(`${record.path}/`));
}

/**
 * Sorts every level of the tree naturally by name, in place.
 */
function sortChildren(node: TargetDirectory): void {
  node.children.sort((a, b) => naturalCompare(a.name, b.name));
  for (const child of node.children) sortChildren(child);
}
