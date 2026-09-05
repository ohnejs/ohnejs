import { deepStrictEqual, strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import type { UploadRecord } from '../../../../src/uploads/uploads/types.ts';

import {
  buildTargetTree,
  hasValidTarget,
  type TargetDirectory,
} from '../../../../src/uploads/dashboard/components/_target-tree.ts';

function upload(path: string, kind: 'file' | 'folder' = 'file'): UploadRecord {
  const slash = path.lastIndexOf('/');
  const directory = slash === -1 ? '' : path.slice(0, slash);
  const name = path.slice(slash + 1);
  return {
    UUID: path,
    kind,
    directory,
    name,
    type: kind === 'file' ? 'image/png' : null,
    size: kind === 'file' ? 1 : null,
    hash: null,
    width: null,
    height: null,
    description: null,
    focalX: null,
    focalY: null,
    author: null,
    uploadedAt: 0,
    _updatedAt: 0,
    path,
    url: `/uploads/${path}`,
  };
}

const names = (nodes: readonly TargetDirectory[]): string[] => nodes.map((node) => node.name);

const find = (node: TargetDirectory, path: string): TargetDirectory | undefined => {
  if (node.path === path) return node;
  for (const child of node.children) {
    const hit = find(child, path);
    if (hit) return hit;
  }
  return undefined;
};

describe('buildTargetTree', () => {
  it('nests folders by path and sorts every level naturally', () => {
    const tree = buildTargetTree(
      ['photos/2024', 'photos', 'docs', 'photos/b10', 'photos/b2'],
      [upload('notes.txt')],
      'Root',
    );
    strictEqual(tree.path, '');
    strictEqual(tree.name, 'Root');
    deepStrictEqual(names(tree.children), ['docs', 'photos']);
    deepStrictEqual(names(find(tree, 'photos')?.children ?? []), ['2024', 'b2', 'b10']);
  });

  it('implies a missing ancestor from its descendants', () => {
    const tree = buildTargetTree(['a/b/c'], [upload('notes.txt')], 'Root');
    strictEqual(find(tree, 'a')?.path, 'a');
    strictEqual(find(tree, 'a/b')?.path, 'a/b');
    strictEqual(find(tree, 'a/b/c')?.path, 'a/b/c');
  });

  it('disables a selected folder and everything inside it', () => {
    const tree = buildTargetTree(
      ['photos', 'photos/2024', 'photos-archive', 'docs'],
      [upload('photos', 'folder')],
      'Root',
    );
    strictEqual(find(tree, 'photos')?.disabled, true);
    strictEqual(find(tree, 'photos/2024')?.disabled, true);
    strictEqual(find(tree, 'photos-archive')?.disabled, false);
    strictEqual(find(tree, 'docs')?.disabled, false);
    strictEqual(tree.disabled, true);
  });

  it('keeps the root open while any selected row sits below it', () => {
    const tree = buildTargetTree(
      ['photos'],
      [upload('photos/sunset.png'), upload('a.txt')],
      'Root',
    );
    strictEqual(tree.disabled, false);
    strictEqual(find(tree, 'photos')?.disabled, false);
  });
});

describe('hasValidTarget', () => {
  it('finds an open folder at any depth', () => {
    const tree = buildTargetTree(['a', 'a/b'], [upload('a', 'folder')], 'Root');
    strictEqual(hasValidTarget(tree), false);
    const open = buildTargetTree(['a', 'a/b', 'c'], [upload('a', 'folder')], 'Root');
    strictEqual(hasValidTarget(open), true);
  });

  it('counts the root itself', () => {
    const tree = buildTargetTree([], [upload('photos/sunset.png')], 'Root');
    strictEqual(hasValidTarget(tree), true);
  });
});
