import type { StorageAdapter } from '../../src/uploads/storage/adapter.ts';

/**
 * The effects `failNext` can make throw once.
 */
export type MemoryStorageOp = 'move' | 'delete' | 'setPrivate';

/**
 * A `StorageAdapter` over a `Map`, with the objects and their visibility exposed.
 * `failNext` makes the next effect of one kind throw once.
 */
export interface MemoryStorage extends StorageAdapter {
  objects: Map<string, Uint8Array>;
  visibility: Map<string, boolean>;
  failNext(op: MemoryStorageOp): void;
}

/**
 * Builds an adapter that keeps every object in `objects`, keyed by path.
 * `move` and `delete` also carry a prefix's descendants, as a folder effect needs.
 * An object's visibility moves with it and goes with it on a delete.
 * `setPrivate` records the object at the path and every one under it in `visibility`, `true` for private.
 * Like `move` and `delete`, it passes over a path that holds nothing.
 * `failNext(op)` makes the next call of that op throw once, then the adapter works again.
 */
export function createMemoryStorage(): MemoryStorage {
  const objects = new Map<string, Uint8Array>();
  const visibility = new Map<string, boolean>();
  let failing: MemoryStorageOp | null = null;

  const fail = (op: MemoryStorageOp): void => {
    if (failing !== op) return;
    failing = null;
    throw new Error(`memory storage ${op} failed`);
  };
  const under = (prefix: string): string[] =>
    [...objects.keys()].filter((key) => key.startsWith(`${prefix}/`));
  const carry = (from: string, to: string): void => {
    const value = visibility.get(from);
    visibility.delete(from);
    if (value === undefined) visibility.delete(to);
    else visibility.set(to, value);
  };

  return {
    objects,
    visibility,
    failNext(op) {
      failing = op;
    },
    async write(path, body) {
      objects.set(path, await new Response(body).bytes());
    },
    async read(path, range) {
      const bytes = objects.get(path);
      if (bytes === undefined) return null;
      const slice = bytes.subarray(range?.start ?? 0, (range?.end ?? bytes.byteLength - 1) + 1);
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(slice);
          controller.close();
        },
      });
      return { body, size: bytes.byteLength };
    },
    async stat(path) {
      const bytes = objects.get(path);
      return bytes === undefined ? null : { size: bytes.byteLength };
    },
    async *list(prefix = '') {
      for (const key of objects.keys()) {
        if (prefix === '' || key === prefix || key.startsWith(`${prefix}/`)) yield key;
      }
    },
    async move(from, to) {
      fail('move');
      const bytes = objects.get(from);
      if (bytes !== undefined) {
        objects.delete(from);
        objects.set(to, bytes);
        carry(from, to);
      }
      for (const key of under(from)) {
        const target = to + key.slice(from.length);
        objects.set(target, objects.get(key)!);
        objects.delete(key);
        carry(key, target);
      }
    },
    async delete(path) {
      fail('delete');
      objects.delete(path);
      visibility.delete(path);
      for (const key of under(path)) {
        objects.delete(key);
        visibility.delete(key);
      }
    },
    async setPrivate(path, value) {
      fail('setPrivate');
      if (objects.has(path)) visibility.set(path, value);
      for (const key of under(path)) visibility.set(key, value);
    },
  };
}
